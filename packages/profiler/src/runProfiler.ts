import type {
  Arbiter,
  AuditStore,
  Harness,
  Logger,
  ProfileQueue,
  ProfileStore,
  Verifier,
} from "@scout/shared";
import { profilerConfig } from "./config.js";
import { createLru } from "./lru.js";
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

export function createProfiler(deps: ProfilerDeps): ProfilerHandle {
  const abort = new AbortController();
  wireAbort(deps.signal, abort);
  let runPromise: Promise<void> | null = null;
  return {
    async start() {
      if (runPromise === null) runPromise = runProfilerLoop(deps, abort);
      await runPromise;
    },
    async stop() {
      abort.abort();
      if (runPromise !== null) await runPromise;
    },
  };
}

export async function runProfiler(deps: ProfilerDeps): Promise<void> {
  const abort = new AbortController();
  wireAbort(deps.signal, abort);
  await runProfilerLoop(deps, abort);
}

async function runProfilerLoop(deps: ProfilerDeps, abort: AbortController): Promise<void> {
  const cfg = profilerConfig();
  const seen = createLru<string>(cfg.processedLruSize);
  const slot = createSemaphore(cfg.concurrency);
  const inflight = new Set<Promise<void>>();
  try {
    for await (const tuple of deps.queue.consume({
      signal: abort.signal,
      visibilityTimeoutMs: cfg.visibilityTimeoutMs,
    })) {
      await slot.acquire();
      // Catch-all so unexpected throws don't surface as unhandledRejection
      // (Task 8 asserts this explicitly).
      const p: Promise<void> = handleJob(deps, cfg, seen, tuple, abort.signal)
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
