import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { profilerConfig } from "../config.js";

// PRP-D D10: every env var the profiler reads. Audit grep
// `grep -rn 'process\.env' packages/profiler/src` must return only config.ts.
const ENV_KEYS = [
  // PRP-C keys (carry-over)
  "PROFILER_CONCURRENCY",
  "PROFILER_VERIFIER_TIMEOUT_MS",
  "PROFILER_PROCESSED_LRU_SIZE",
  "PROFILER_TTL_DEFAULT_SECONDS",
  "PROFILER_VISIBILITY_TIMEOUT_MS",
  "PROFILER_SHUTDOWN_GRACE_MS",
  // PRP-D additions — trip-wire + TTL heuristic + retry
  "PROFILER_COST_WINDOW_MS",
  "PROFILER_COST_WINDOW_SOFT",
  "PROFILER_COST_WINDOW_HARD",
  "PROFILER_TTL_NEWS_SECONDS",
  "PROFILER_TTL_UGC_SECONDS",
  "PROFILER_BACKOFF_BASE_MS",
  "PROFILER_BACKOFF_CAP_MS",
  "PROFILER_MAX_ATTEMPTS",
];

describe("profilerConfig()", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("defaults when env is unset (PRP-C + PRP-D D5/D10)", () => {
    it("returns the locked defaults", () => {
      const cfg = profilerConfig();
      // PRP-C carry-over
      expect(cfg.concurrency).toBe(4);
      expect(cfg.verifierTimeoutMs).toBe(30_000);
      expect(cfg.processedLruSize).toBe(1024);
      expect(cfg.ttlDefaultSeconds).toBe(21_600);
      expect(cfg.visibilityTimeoutMs).toBe(90_000);
      expect(cfg.shutdownGraceMs).toBe(30_000);
      // PRP-D additions
      expect(cfg.costWindowMs).toBe(60_000);
      expect(cfg.costWindowSoft).toBe(8_000);
      expect(cfg.costWindowHard).toBe(16_000);
      expect(cfg.ttlNewsSeconds).toBe(1_800);
      expect(cfg.ttlUgcSeconds).toBe(600);
      expect(cfg.backoffBaseMs).toBe(500);
      expect(cfg.backoffCapMs).toBe(60_000);
      expect(cfg.maxAttempts).toBe(5);
    });
  });

  describe("positive-int overrides", () => {
    it("reads PRP-C carry-over overrides", () => {
      vi.stubEnv("PROFILER_CONCURRENCY", "8");
      vi.stubEnv("PROFILER_VERIFIER_TIMEOUT_MS", "12000");
      const cfg = profilerConfig();
      expect(cfg.concurrency).toBe(8);
      expect(cfg.verifierTimeoutMs).toBe(12_000);
    });

    it("reads PRP-D trip-wire / TTL / retry overrides", () => {
      vi.stubEnv("PROFILER_COST_WINDOW_MS", "30000");
      vi.stubEnv("PROFILER_COST_WINDOW_SOFT", "4000");
      vi.stubEnv("PROFILER_COST_WINDOW_HARD", "12000");
      vi.stubEnv("PROFILER_TTL_NEWS_SECONDS", "900");
      vi.stubEnv("PROFILER_TTL_UGC_SECONDS", "300");
      vi.stubEnv("PROFILER_BACKOFF_BASE_MS", "250");
      vi.stubEnv("PROFILER_BACKOFF_CAP_MS", "30000");
      vi.stubEnv("PROFILER_MAX_ATTEMPTS", "3");
      const cfg = profilerConfig();
      expect(cfg.costWindowMs).toBe(30_000);
      expect(cfg.costWindowSoft).toBe(4_000);
      expect(cfg.costWindowHard).toBe(12_000);
      expect(cfg.ttlNewsSeconds).toBe(900);
      expect(cfg.ttlUgcSeconds).toBe(300);
      expect(cfg.backoffBaseMs).toBe(250);
      expect(cfg.backoffCapMs).toBe(30_000);
      expect(cfg.maxAttempts).toBe(3);
    });
  });

  describe("silent fallback on invalid values (PRP-D D10)", () => {
    it("falls back to default on non-numeric input", () => {
      vi.stubEnv("PROFILER_CONCURRENCY", "abc");
      vi.stubEnv("PROFILER_COST_WINDOW_SOFT", "not-a-number");
      const cfg = profilerConfig();
      expect(cfg.concurrency).toBe(4);
      expect(cfg.costWindowSoft).toBe(8_000);
    });

    it("falls back to default on zero or negative", () => {
      vi.stubEnv("PROFILER_CONCURRENCY", "0");
      vi.stubEnv("PROFILER_MAX_ATTEMPTS", "-1");
      const cfg = profilerConfig();
      expect(cfg.concurrency).toBe(4);
      expect(cfg.maxAttempts).toBe(5);
    });

    it("falls back to default on empty string", () => {
      vi.stubEnv("PROFILER_BACKOFF_BASE_MS", "");
      expect(profilerConfig().backoffBaseMs).toBe(500);
    });
  });
});
