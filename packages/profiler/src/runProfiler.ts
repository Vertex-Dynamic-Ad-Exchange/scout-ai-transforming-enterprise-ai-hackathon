import type {
  Arbiter,
  AuditStore,
  Harness,
  Logger,
  ProfileQueue,
  ProfileStore,
  Verifier,
} from "@scout/shared";
import { profilerConfig, type ProfilerConfig } from "./config.js";
import { createLru, type Lru } from "./lru.js";
import { createSpendWindow, type SpendWindow } from "./costTripwire.js";
import { handleJob } from "./handleJob.js";

/** PRP-C D1 — plug-and-play DI seam. Field order locked here. */
export interface ProfilerDeps {
  harness: Harness;
  verifiers: { text: Verifier; image: Verifier; video: Verifier; combined?: Verifier };
  arbiter: Arbiter;
  queue: ProfileQueue;
  profileStore: ProfileStore;
  auditStore: AuditStore;
  logger: Logger;
  clock?: () => number;
  signal?: AbortSignal;
}

export interface ProfilerHandle {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * PRP-E Task 4 (D8): worker-visible shutdown state. Workers check
 * `gracePassed` after each pipeline await and, if set, nack-transient
 * `detail: "shutdown"` instead of acking. The at-least-once invariant
 * depends on the no-`ack`-on-shutdown rule (`runProfiler.shutdown.test.ts`).
 */
export interface ShutdownState {
  initiated: boolean;
  gracePassed: boolean;
}

interface Semaphore {
  acquire(): Promise<void>;
  release(): void;
}

function createSemaphore(capacity: number): Semaphore {
  let inflight = 0;
  const waiters: (() => void)[] = [];
  return {
    async acquire() {
      if (inflight < capacity) {
        inflight++;
        return;
      }
      await new Promise<void>((resolve) =>
        waiters.push(() => {
          inflight++;
          resolve();
        }),
      );
    },
    release() {
      inflight--;
      waiters.shift()?.();
    },
  };
}

function wireAbort(parent: AbortSignal | undefined, ctl: AbortController): void {
  if (parent === undefined) return;
  if (parent.aborted) ctl.abort();
  else parent.addEventListener("abort", () => ctl.abort(), { once: true });
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export function createProfiler(deps: ProfilerDeps): ProfilerHandle {
  // PRP-E D9: `seen` (LRU) and `window` (cost trip-wire) PRESERVED across
  // stop+start in the same process. Clearing them on stop() would re-process
  // recently-acked jobs on re-delivery and reset cost trip-wire calibration.
  const cfg = profilerConfig();
  const seen = createLru<string>(cfg.processedLruSize);
  const window = createSpendWindow();

  let abort: AbortController | null = null;
  let runPromise: Promise<void> | null = null;
  let stopPromise: Promise<void> | null = null;
  let shutdownState: ShutdownState | null = null;
  let inflight: Set<Promise<void>> | null = null;

  return {
    async start() {
      if (runPromise !== null) {
        await runPromise;
        return;
      }
      abort = new AbortController();
      wireAbort(deps.signal, abort);
      shutdownState = { initiated: false, gracePassed: false };
      inflight = new Set();
      runPromise = runProfilerLoop(deps, cfg, abort, seen, window, shutdownState, inflight);
      await runPromise;
    },
    async stop() {
      // PRP-E Task 4 — idempotent. Second stop() is a no-op pending the first.
      if (stopPromise !== null) {
        await stopPromise;
        return;
      }
      if (abort === null || shutdownState === null || inflight === null) {
        // never started
        return;
      }
      stopPromise = doStop(cfg, abort, shutdownState, inflight, runPromise);
      try {
        await stopPromise;
      } finally {
        // Reset per-run state so a subsequent start() begins a fresh loop while
        // keeping the cross-run `seen` + `window` (D9).
        runPromise = null;
        stopPromise = null;
        abort = null;
        shutdownState = null;
        inflight = null;
      }
    },
  };
}

export async function runProfiler(deps: ProfilerDeps): Promise<void> {
  const cfg = profilerConfig();
  const seen = createLru<string>(cfg.processedLruSize);
  const window = createSpendWindow();
  const abort = new AbortController();
  wireAbort(deps.signal, abort);
  const state: ShutdownState = { initiated: false, gracePassed: false };
  const inflight = new Set<Promise<void>>();
  await runProfilerLoop(deps, cfg, abort, seen, window, state, inflight);
}

async function runProfilerLoop(
  deps: ProfilerDeps,
  cfg: ProfilerConfig,
  abort: AbortController,
  seen: Lru<string>,
  window: SpendWindow,
  shutdownState: ShutdownState,
  inflight: Set<Promise<void>>,
): Promise<void> {
  const slot = createSemaphore(cfg.concurrency);
  try {
    for await (const tuple of deps.queue.consume({
      signal: abort.signal,
      visibilityTimeoutMs: cfg.visibilityTimeoutMs,
    })) {
      await slot.acquire();
      // Catch-all so unexpected throws don't surface as unhandledRejection
      // (PRP-C Task 8 asserts this explicitly).
      const p: Promise<void> = handleJob(
        deps,
        cfg,
        seen,
        window,
        tuple,
        abort.signal,
        shutdownState,
      )
        .catch((e: unknown) =>
          deps.logger.error({
            event: "handle_job_unexpected_error",
            jobId: tuple.job.id,
            error: e instanceof Error ? e.message : String(e),
          }),
        )
        .finally(() => {
          inflight.delete(p);
          slot.release();
        });
      inflight.add(p);
    }
  } finally {
    await Promise.allSettled([...inflight]);
  }
}

/**
 * PRP-E Task 4 / D8 stop() semantic:
 *   1. Mark `initiated`, abort the controller (consume() returns, verifier
 *      contexts see `abortSignal.aborted === true`).
 *   2. Wait `shutdownGraceMs` for in-flight workers to settle NATURALLY
 *      (ack on commit, nack on classified failure).
 *   3. After grace, flip `gracePassed = true`. Workers observing it on their
 *      next checkpoint nack-transient `detail: "shutdown"` instead of acking.
 *   4. Wait an additional `shutdownHardKillMs` for those nacks to settle.
 *   5. Resolve regardless. At-least-once: NO `ack` on the shutdown path.
 */
async function doStop(
  cfg: ProfilerConfig,
  abort: AbortController,
  shutdownState: ShutdownState,
  inflight: Set<Promise<void>>,
  runPromise: Promise<void> | null,
): Promise<void> {
  shutdownState.initiated = true;
  abort.abort();

  // Phase 1: natural settle within grace.
  await Promise.race([Promise.allSettled([...inflight]), delay(cfg.shutdownGraceMs)]);
  if (inflight.size === 0) {
    if (runPromise !== null) await runPromise.catch(() => undefined);
    return;
  }

  // Phase 2: grace expired. Flip the flag — workers self-nack-transient on
  // their next checkpoint. We do NOT call `nack` directly from here because
  // the queue forbids double-settle (a worker about to ack would race us).
  shutdownState.gracePassed = true;

  // Phase 3: bounded wait for the shutdown nacks to settle.
  await Promise.race([Promise.allSettled([...inflight]), delay(cfg.shutdownHardKillMs)]);

  if (runPromise !== null) await runPromise.catch(() => undefined);
}
