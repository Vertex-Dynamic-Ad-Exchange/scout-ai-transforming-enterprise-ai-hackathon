// PRP-D Tasks 3-4: retry policy = stateless classifier (NackReason) + arithmetic
// (backoff curve). Pure logic; no module-state; no env reads outside config.ts.

import { HarnessException, type NackReason } from "@scout/shared";
import { profilerConfig } from "./config.js";

export interface ClassifyCtx {
  /** PRP-A `ProfileJob.attempt`. 1-based; profiler increments at requeue. */
  readonly attempt: number;
  /** PRP-D D6 sub-case: distinguish shutdown-driven aborts. */
  readonly shutdownDriven: boolean;
}

/**
 * PRP-D D4/D5: backoff curve `min(2^attempt * BASE_MS, CAP_MS)`. `attempt=1`
 * yields a 1s wait (`2 * 500ms`), giving upstream room to recover before the
 * first retry. Returns an ISO8601 timestamp suitable for `NackReason.retryAt`.
 */
export function computeRetryAt(attempt: number, now: number = Date.now()): string {
  const cfg = profilerConfig();
  const waitMs = Math.min(2 ** attempt * cfg.backoffBaseMs, cfg.backoffCapMs);
  return new Date(now + waitMs).toISOString();
}

/**
 * PRP-D D6 matrix. Maps an error caught in the profiler worker to a
 * `NackReason` the queue impl can honor. Detail strings are short, enum-like
 * tokens — NEVER include `job.pageUrl` or `capture.domText` excerpts (PRP-D
 * § Anti-patterns).
 */
export function classifyError(err: unknown, ctx: ClassifyCtx): NackReason {
  const cfg = profilerConfig();

  // Attempt cap dominates every code path. A retried-then-still-failing
  // upstream eventually poisons rather than retrying forever (feature
  // line 107: the "DENY-spam the same page forever" failure mode).
  if (ctx.attempt >= cfg.maxAttempts) {
    return { kind: "poison", detail: "max_attempts_exhausted" };
  }

  if (err instanceof HarnessException) {
    if (err.code === "CONSENT_WALL_UNRESOLVED") {
      // Structural — a fresh session won't pass the wall any more than the
      // first one did. Poison immediately.
      return { kind: "poison", detail: "consent_wall_unresolved" };
    }
    if (err.code === "BLOCKED" && ctx.attempt >= 2) {
      // Sometimes resolves on retry-1 with a fresh session; rarely on
      // retry-2. PRP-D D6: hard ceiling at attempt 2.
      return { kind: "poison", detail: "blocked_after_retry" };
    }
    return {
      kind: "transient",
      detail: err.code.toLowerCase(),
      retryAt: computeRetryAt(ctx.attempt),
    };
  }

  if (err instanceof Error) {
    if (err.name === "AbortError") {
      return {
        kind: "transient",
        detail: ctx.shutdownDriven ? "shutdown" : "abort",
        retryAt: computeRetryAt(ctx.attempt),
      };
    }
    if (err.name === "ZodError") {
      // A `PageProfile` that fails its own schema is a code bug — retrying
      // won't fix malformed output.
      return { kind: "poison", detail: "profile_schema_invalid" };
    }
  }

  return { kind: "transient", detail: "unknown", retryAt: computeRetryAt(ctx.attempt) };
}
