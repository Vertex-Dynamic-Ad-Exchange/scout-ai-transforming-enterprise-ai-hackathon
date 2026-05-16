// SECURITY: this is the ONLY file in packages/profiler/src/** allowed to read
// process.env.*. PRP-C § Security guardrails + § Anti-patterns enforce that
// the audit grep `grep -rn 'process\.env' packages/profiler/src` returns only
// this file. Never reads `GEMINI_API_KEY` or `BROWSER_USE_API_KEY` — those
// belong to `@scout/llm-client` and `@scout/harness`.

export interface ProfilerConfig {
  /** Bounded fanout cap. Default `4` matches harness Cloud concurrency (D2). */
  readonly concurrency: number;

  /** Per-verifier timeout (ms). Total worst-case ≤ capture + this + commit (D3). */
  readonly verifierTimeoutMs: number;

  /** Per-process idempotency cache cap (D9). */
  readonly processedLruSize: number;

  /** Flat TTL until PRP-D's heuristic lands. */
  readonly ttlDefaultSeconds: number;

  /** Queue visibility-timeout passed through to `ProfileQueue.consume`. */
  readonly visibilityTimeoutMs: number;

  /** Grace period for in-flight jobs on `stop()`. PRP-E polishes. */
  readonly shutdownGraceMs: number;
}

const DEFAULTS = {
  concurrency: 4,
  verifierTimeoutMs: 30_000,
  processedLruSize: 1024,
  ttlDefaultSeconds: 21_600,
  visibilityTimeoutMs: 90_000,
  shutdownGraceMs: 30_000,
} as const;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer; got ${JSON.stringify(raw)}`);
  }
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
  };
}
