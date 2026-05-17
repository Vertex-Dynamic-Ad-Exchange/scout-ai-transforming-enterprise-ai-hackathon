// SECURITY: this is the ONLY file in packages/profiler/src/** allowed to read
// process.env.*. PRP-D § Security guardrails + § Anti-patterns enforce the
// audit grep `grep -rn 'process\.env' packages/profiler/src` returns only this
// file. Never reads `GEMINI_API_KEY` or `BROWSER_USE_API_KEY` — those belong
// to `@scout/llm-client` and `@scout/harness`.
//
// PRP-D D10: all keys are non-required, so parse failures fall back to the
// default silently (no throw). A future "required env" addition must mirror
// `harnessConfig`'s name-only hint pattern.

export interface ProfilerConfig {
  /** Bounded fanout cap. Default `4` matches harness Cloud concurrency. */
  readonly concurrency: number;

  /** Per-verifier timeout (ms). Total worst-case ≤ capture + this + commit. */
  readonly verifierTimeoutMs: number;

  /** Per-process idempotency cache cap. */
  readonly processedLruSize: number;

  /** Flat TTL fallback when neither news-og-type nor UGC host matches. */
  readonly ttlDefaultSeconds: number;

  /** Queue visibility-timeout passed through to `ProfileQueue.consume`. */
  readonly visibilityTimeoutMs: number;

  /** Grace period for in-flight jobs on `stop()`. */
  readonly shutdownGraceMs: number;

  /**
   * PRP-E D8: hard-kill ceiling beyond `shutdownGraceMs`. After grace, in-flight
   * jobs are force-nacked-transient (`detail: "shutdown"`); this is the cap
   * `stop()` waits for those nacks to settle before resolving regardless.
   */
  readonly shutdownHardKillMs: number;

  /** PRP-D D1: sliding-window length for the cost trip-wire. */
  readonly costWindowMs: number;

  /** PRP-D: trip threshold to upgrade hint to `drop_video`. */
  readonly costWindowSoft: number;

  /** PRP-D: trip threshold to upgrade hint to `collapse_text_image`. */
  readonly costWindowHard: number;

  /** PRP-D: TTL for news / article / video og-type pages (seconds). */
  readonly ttlNewsSeconds: number;

  /** PRP-D: TTL for known-UGC hosts (seconds). */
  readonly ttlUgcSeconds: number;

  /** PRP-D D4: backoff base — `attempt=1` waits `2 * base = base*2`. */
  readonly backoffBaseMs: number;

  /** PRP-D D5: backoff cap. */
  readonly backoffCapMs: number;

  /** PRP-D D5: poison after this many attempts regardless of error class. */
  readonly maxAttempts: number;
}

const DEFAULTS: ProfilerConfig = {
  concurrency: 4,
  verifierTimeoutMs: 30_000,
  processedLruSize: 1024,
  ttlDefaultSeconds: 21_600,
  visibilityTimeoutMs: 90_000,
  shutdownGraceMs: 30_000,
  shutdownHardKillMs: 5_000,
  costWindowMs: 60_000,
  costWindowSoft: 8_000,
  costWindowHard: 16_000,
  ttlNewsSeconds: 1_800,
  ttlUgcSeconds: 600,
  backoffBaseMs: 500,
  backoffCapMs: 60_000,
  maxAttempts: 5,
} as const;

// SECURITY: never echoes the raw env value back to caller / logger / error
// (PRP-D § Security guardrails — "No raw env values in error messages").
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function profilerConfig(): ProfilerConfig {
  return {
    concurrency: readPositiveInt("PROFILER_CONCURRENCY", DEFAULTS.concurrency),
    verifierTimeoutMs: readPositiveInt("PROFILER_VERIFIER_TIMEOUT_MS", DEFAULTS.verifierTimeoutMs),
    processedLruSize: readPositiveInt("PROFILER_PROCESSED_LRU_SIZE", DEFAULTS.processedLruSize),
    ttlDefaultSeconds: readPositiveInt("PROFILER_TTL_DEFAULT_SECONDS", DEFAULTS.ttlDefaultSeconds),
    visibilityTimeoutMs: readPositiveInt(
      "PROFILER_VISIBILITY_TIMEOUT_MS",
      DEFAULTS.visibilityTimeoutMs,
    ),
    shutdownGraceMs: readPositiveInt("PROFILER_SHUTDOWN_GRACE_MS", DEFAULTS.shutdownGraceMs),
    shutdownHardKillMs: readPositiveInt(
      "PROFILER_SHUTDOWN_HARD_KILL_MS",
      DEFAULTS.shutdownHardKillMs,
    ),
    costWindowMs: readPositiveInt("PROFILER_COST_WINDOW_MS", DEFAULTS.costWindowMs),
    costWindowSoft: readPositiveInt("PROFILER_COST_WINDOW_SOFT", DEFAULTS.costWindowSoft),
    costWindowHard: readPositiveInt("PROFILER_COST_WINDOW_HARD", DEFAULTS.costWindowHard),
    ttlNewsSeconds: readPositiveInt("PROFILER_TTL_NEWS_SECONDS", DEFAULTS.ttlNewsSeconds),
    ttlUgcSeconds: readPositiveInt("PROFILER_TTL_UGC_SECONDS", DEFAULTS.ttlUgcSeconds),
    backoffBaseMs: readPositiveInt("PROFILER_BACKOFF_BASE_MS", DEFAULTS.backoffBaseMs),
    backoffCapMs: readPositiveInt("PROFILER_BACKOFF_CAP_MS", DEFAULTS.backoffCapMs),
    maxAttempts: readPositiveInt("PROFILER_MAX_ATTEMPTS", DEFAULTS.maxAttempts),
  };
}
