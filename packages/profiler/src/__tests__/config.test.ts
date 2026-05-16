import { beforeEach, describe, expect, it } from "vitest";
import { profilerConfig } from "../config.js";

const KEYS = [
  "PROFILER_CONCURRENCY",
  "PROFILER_VERIFIER_TIMEOUT_MS",
  "PROFILER_PROCESSED_LRU_SIZE",
  "PROFILER_TTL_DEFAULT_SECONDS",
  "PROFILER_VISIBILITY_TIMEOUT_MS",
  "PROFILER_SHUTDOWN_GRACE_MS",
];

describe("profilerConfig", () => {
  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it("falls back to PRP-C defaults when env is empty (D2, D3, D9)", () => {
    const cfg = profilerConfig();
    expect(cfg.concurrency).toBe(4);
    expect(cfg.verifierTimeoutMs).toBe(30_000);
    expect(cfg.processedLruSize).toBe(1024);
    expect(cfg.ttlDefaultSeconds).toBe(21_600);
    expect(cfg.visibilityTimeoutMs).toBe(90_000);
    expect(cfg.shutdownGraceMs).toBe(30_000);
  });

  it("reads positive int overrides", () => {
    process.env["PROFILER_CONCURRENCY"] = "8";
    process.env["PROFILER_VERIFIER_TIMEOUT_MS"] = "12000";
    expect(profilerConfig().concurrency).toBe(8);
    expect(profilerConfig().verifierTimeoutMs).toBe(12_000);
  });

  it("rejects non-positive or non-numeric values", () => {
    process.env["PROFILER_CONCURRENCY"] = "0";
    expect(() => profilerConfig()).toThrow(/positive integer/);
    process.env["PROFILER_CONCURRENCY"] = "-1";
    expect(() => profilerConfig()).toThrow(/positive integer/);
    process.env["PROFILER_CONCURRENCY"] = "abc";
    expect(() => profilerConfig()).toThrow(/positive integer/);
  });
});
