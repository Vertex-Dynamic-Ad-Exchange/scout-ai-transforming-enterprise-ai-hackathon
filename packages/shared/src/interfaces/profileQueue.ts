import type { ProfileJob } from "../schemas/job.js";

/**
 * Reason attached to `QueueDelivery.nack`. `kind: "transient"` carries a
 * `retryAt` ISO8601 string for backoff; `kind: "poison"` omits it — the job
 * routes to the DLQ. PRP-D consumes this for DLQ + backoff (D14).
 */
export interface NackReason {
  kind: "transient" | "poison";
  detail: string;
  retryAt?: string;
}

export interface QueueDelivery {
  job: ProfileJob;
  ack(): Promise<void>;
  nack(reason: NackReason): Promise<void>;
}

export interface ConsumeOptions {
  signal: AbortSignal;
  visibilityTimeoutMs: number;
}

/**
 * Gate (cache-miss path) enqueues; profiler consumes. The `consume` half is an
 * `AsyncIterableIterator` so the profiler can write a `for await ... of` loop
 * with bounded-concurrency fan-out (D13). Impls land in PRP-B.
 */
export interface ProfileQueue {
  enqueue(job: ProfileJob): Promise<void>;
  consume(opts: ConsumeOptions): AsyncIterableIterator<QueueDelivery>;
}
