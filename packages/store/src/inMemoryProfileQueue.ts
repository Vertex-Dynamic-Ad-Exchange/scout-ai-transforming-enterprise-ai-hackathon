import type {
  ConsumeOptions,
  NackReason,
  ProfileJob,
  ProfileQueue,
  QueueDelivery,
} from "@scout/shared";

interface LeaseState {
  job: ProfileJob;
  leasedAt: number;
  settled: boolean;
}

interface ScheduledEntry {
  job: ProfileJob;
  releaseAt: number;
}

export interface InMemoryProfileQueueOptions {
  clock?: () => number;
}

/**
 * Single-process `ProfileQueue`. Lazy visibility-timeout reclaim on
 * `next()` (mirrors `XAUTOCLAIM`, PRP-B D1); FIFO with re-delivers
 * (transient nack + reclaim) jumping to head per D9. One shared
 * `pendingResolver` — single-consumer per instance; Redis Streams impl
 * (PRP-B § Out of scope) replaces with consumer groups.
 */
export class InMemoryProfileQueue implements ProfileQueue {
  private readonly pending: ProfileJob[] = [];
  private scheduled: ScheduledEntry[] = [];
  private readonly inFlight: Map<string, LeaseState> = new Map();
  private readonly dlq: ProfileJob[] = [];
  private leaseCounter = 0;
  private pendingResolver: (() => void) | null = null;
  private readonly clock: () => number;

  constructor(opts?: InMemoryProfileQueueOptions) {
    this.clock = opts?.clock ?? Date.now;
  }

  async enqueue(job: ProfileJob): Promise<void> {
    this.pending.push(job);
    this.pendingResolver?.();
  }

  consume(opts: ConsumeOptions): AsyncIterableIterator<QueueDelivery> {
    const { signal, visibilityTimeoutMs } = opts;
    const queue = this;
    async function* generator(): AsyncGenerator<QueueDelivery> {
      while (true) {
        if (signal.aborted) return;
        queue.drainScheduled();
        queue.reclaimExpiredLeases(visibilityTimeoutMs);
        if (queue.pending.length === 0) {
          await queue.waitForWork(signal, visibilityTimeoutMs);
          if (signal.aborted) return;
          continue;
        }
        const job = queue.pending.shift();
        if (job === undefined) continue;
        const leaseId = String(++queue.leaseCounter);
        const lease: LeaseState = { job, leasedAt: queue.clock(), settled: false };
        queue.inFlight.set(leaseId, lease);
        yield queue.buildDelivery(leaseId, lease);
      }
    }
    return generator();
  }

  /** D6: shallow-copied snapshot; auditing is read-only. */
  getDLQ(): readonly ProfileJob[] {
    return [...this.dlq];
  }

  private buildDelivery(leaseId: string, lease: LeaseState): QueueDelivery {
    const { job } = lease;
    const queue = this;
    let state: "open" | "acked" | "nacked" = "open";

    return {
      job,
      async ack(): Promise<void> {
        if (state === "acked") throw new Error(`double ack on job ${job.id}`);
        if (state === "nacked") throw new Error(`ack after nack on job ${job.id}`);
        if (lease.settled) {
          throw new Error(`tuple expired (visibility timeout reclaimed) on job ${job.id}`);
        }
        state = "acked";
        lease.settled = true;
        queue.inFlight.delete(leaseId);
      },
      async nack(reason: NackReason): Promise<void> {
        if (state === "nacked") throw new Error(`double nack on job ${job.id}`);
        if (state === "acked") throw new Error(`nack after ack on job ${job.id}`);
        if (lease.settled) {
          throw new Error(`tuple expired (visibility timeout reclaimed) on job ${job.id}`);
        }
        state = "nacked";
        lease.settled = true;
        queue.inFlight.delete(leaseId);

        if (reason.kind === "transient") {
          const now = queue.clock();
          const parsedRetry =
            reason.retryAt !== undefined ? Date.parse(reason.retryAt) : Number.NaN;
          const releaseAt = Number.isFinite(parsedRetry) ? Math.max(now, parsedRetry) : now;
          queue.scheduled.push({
            job: { ...job, attempt: job.attempt + 1 },
            releaseAt,
          });
          queue.pendingResolver?.();
        } else {
          queue.dlq.push(job);
        }
      },
    };
  }

  private drainScheduled(): void {
    if (this.scheduled.length === 0) return;
    const now = this.clock();
    const due: ProfileJob[] = [];
    const remaining: ScheduledEntry[] = [];
    for (const item of this.scheduled) {
      if (item.releaseAt <= now) due.push(item.job);
      else remaining.push(item);
    }
    if (due.length === 0) return;
    this.scheduled = remaining;
    this.pending.unshift(...due);
  }

  private reclaimExpiredLeases(visibilityTimeoutMs: number): void {
    if (this.inFlight.size === 0) return;
    const now = this.clock();
    const expired: ProfileJob[] = [];
    for (const [leaseId, lease] of Array.from(this.inFlight)) {
      if (now - lease.leasedAt > visibilityTimeoutMs) {
        lease.settled = true;
        this.inFlight.delete(leaseId);
        expired.push({ ...lease.job, attempt: lease.job.attempt + 1 });
      }
    }
    if (expired.length > 0) this.pending.unshift(...expired);
  }

  /**
   * Wake on enqueue, transient-nack re-deliver, abort, scheduled release,
   * or reclaim due. setTimeout closes the implementer-note deadlock: a
   * future-`retryAt` nack on an empty queue would otherwise block forever.
   */
  private waitForWork(signal: AbortSignal, visibilityTimeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = (): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        signal.removeEventListener("abort", cleanup);
        if (this.pendingResolver === cleanup) {
          this.pendingResolver = null;
        }
        resolve();
      };

      this.pendingResolver = cleanup;
      if (signal.aborted) {
        cleanup();
        return;
      }
      signal.addEventListener("abort", cleanup, { once: true });
      const delayMs = this.computeNextEventDelayMs(visibilityTimeoutMs);
      if (delayMs !== null) {
        timer = setTimeout(cleanup, Math.max(0, delayMs));
      }
    });
  }

  private computeNextEventDelayMs(visibilityTimeoutMs: number): number | null {
    const now = this.clock();
    let nextAt = Number.POSITIVE_INFINITY;
    for (const item of this.scheduled) {
      if (item.releaseAt < nextAt) nextAt = item.releaseAt;
    }
    // reclaim fires on `now - leasedAt > visibilityTimeoutMs` — wake +1ms past.
    for (const lease of this.inFlight.values()) {
      const reclaimAt = lease.leasedAt + visibilityTimeoutMs + 1;
      if (reclaimAt < nextAt) nextAt = reclaimAt;
    }
    if (!Number.isFinite(nextAt)) return null;
    return nextAt - now;
  }
}
