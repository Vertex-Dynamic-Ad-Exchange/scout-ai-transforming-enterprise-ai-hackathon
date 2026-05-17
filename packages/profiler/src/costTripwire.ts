// PRP-D Tasks 5-7: rolling-window cost trip-wire. Pure logic, no module-state,
// no env reads outside config.ts. Single shared window per profiler process
// (multi-process re-windows per process; filed as a follow-up in PRP-D).

import type { DegradationHint, Logger } from "@scout/shared";
import { profilerConfig } from "./config.js";

interface SpendSample {
  /** Wall-clock `now` at the time `recordSpend` was called. */
  ts: number;
  /** PRP-D D2 cost proxy. */
  cost: number;
}

export interface SpendWindow {
  /** Queue of recent samples; evicted on each `chooseDegradation` call. */
  samples: SpendSample[];
  /** Last hint returned; transitions are logged when this changes. */
  lastHint: DegradationHint;
}

export function createSpendWindow(): SpendWindow {
  return { samples: [], lastHint: "none" };
}

// PRP-D D2 cost proxy. Structural input so a plain `AgentVerdict` (no `usage`
// field on the current schema) is assignable, AND a future verdict shape with
// LlmClient.usage populated falls through automatically. The PRP-E smoke
// script verifies which branch fires against the real Gemini compat layer.
export interface CostInput {
  usage?: { total_tokens?: number | null } | null;
  modelLatencyMs: number;
}

export function costOf(verdict: CostInput): number {
  return verdict.usage?.total_tokens ?? verdict.modelLatencyMs;
}

export function recordSpend(window: SpendWindow, now: number, cost: number): void {
  window.samples.push({ ts: now, cost });
}

// PRP-D D3 hint order: window UPGRADES severity; job-hint is the FLOOR.
const HINT_ORDER: Record<DegradationHint, number> = {
  none: 0,
  drop_video: 1,
  collapse_text_image: 2,
};

const HINTS: DegradationHint[] = ["none", "drop_video", "collapse_text_image"];

function maxHint(a: DegradationHint, b: DegradationHint): DegradationHint {
  return HINT_ORDER[a] >= HINT_ORDER[b] ? a : b;
}

/**
 * PRP-D D1 sliding window. Per-call:
 *  1. Evict samples older than `costWindowMs`.
 *  2. Sum remaining costs.
 *  3. windowHint = `> hard` → `collapse_text_image`, `> soft` → `drop_video`,
 *     else `none`. Strict `>` per Task 6 (8000 still `none`, 9000 trips).
 *  4. Return `maxHint(jobHint, windowHint)` — D3 floor.
 *  5. Log a `cost_tripwire_change` event ONLY on transition (PRP-D
 *     anti-pattern: don't fire on every job).
 */
export function chooseDegradation(
  window: SpendWindow,
  jobHint: DegradationHint,
  now: number,
  logger: Logger,
): DegradationHint {
  const cfg = profilerConfig();
  const cutoff = now - cfg.costWindowMs;

  // O(N) eviction. PRP-D D1 — N bounded by demo throughput (~hundreds).
  while (window.samples.length > 0 && window.samples[0]!.ts < cutoff) {
    window.samples.shift();
  }

  let total = 0;
  for (const s of window.samples) total += s.cost;

  let windowHint: DegradationHint;
  if (total > cfg.costWindowHard) windowHint = "collapse_text_image";
  else if (total > cfg.costWindowSoft) windowHint = "drop_video";
  else windowHint = "none";

  const next = maxHint(jobHint, windowHint);

  if (next !== window.lastHint) {
    // Transition log — body fields only. Per PRP-D § Security: NEVER dump
    // window contents or per-tenant spend patterns; emit the kind change only.
    logger.info({
      event: "cost_tripwire_change",
      from: window.lastHint,
      to: next,
    });
    window.lastHint = next;
  }

  return next;
}

// Re-export the locked hint order so future helpers / tests pin the same
// monotonicity without re-stating it.
export { HINTS };
