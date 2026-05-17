import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessError, HarnessException, type NackReason } from "@scout/shared";
import { classifyError, computeRetryAt } from "../retry.js";

// Build a ZodError-shaped Error without taking a runtime dep on `zod`
// (PRP-D § CLAUDE.md rules — no new runtime deps).
function makeZodError(): Error {
  const e = new Error("zod parse failure");
  e.name = "ZodError";
  return e;
}

const ENV_KEYS = ["PROFILER_BACKOFF_BASE_MS", "PROFILER_BACKOFF_CAP_MS", "PROFILER_MAX_ATTEMPTS"];

describe("computeRetryAt — D4/D5 curve", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [1, 1_000],
    [2, 2_000],
    [3, 4_000],
    [4, 8_000],
    [8, 60_000], // capped at backoffCapMs (60_000)
    [20, 60_000], // still capped
  ])("attempt=%i waits %i ms", (attempt, expectedWaitMs) => {
    const iso = computeRetryAt(attempt);
    expect(new Date(iso).getTime()).toBe(expectedWaitMs);
  });

  it("honors PROFILER_BACKOFF_BASE_MS override", () => {
    process.env["PROFILER_BACKOFF_BASE_MS"] = "250";
    // 2^1 * 250 = 500ms
    expect(new Date(computeRetryAt(1)).getTime()).toBe(500);
  });

  it("honors PROFILER_BACKOFF_CAP_MS override", () => {
    process.env["PROFILER_BACKOFF_CAP_MS"] = "5000";
    // 2^10 * 500 = 512_000, capped at 5_000
    expect(new Date(computeRetryAt(10)).getTime()).toBe(5_000);
  });
});

describe("classifyError — D6 matrix", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  const isIso = (s: string): boolean => !Number.isNaN(new Date(s).getTime());

  it("HarnessException(TIMEOUT) @attempt=1 → transient/timeout", () => {
    const r = classifyError(new HarnessException(HarnessError.TIMEOUT, "t"), {
      attempt: 1,
      shutdownDriven: false,
    });
    expect(r.kind).toBe("transient");
    expect(r.detail).toBe("timeout");
    expect(r.retryAt).toBeDefined();
    expect(isIso(r.retryAt!)).toBe(true);
  });

  it("HarnessException(UPSTREAM_DOWN) @1 → transient/upstream_down", () => {
    const r = classifyError(new HarnessException(HarnessError.UPSTREAM_DOWN, "u"), {
      attempt: 1,
      shutdownDriven: false,
    });
    expect(r.kind).toBe("transient");
    expect(r.detail).toBe("upstream_down");
  });

  it("HarnessException(NAVIGATION_FAILED) @2 → transient/navigation_failed", () => {
    const r = classifyError(new HarnessException(HarnessError.NAVIGATION_FAILED, "n"), {
      attempt: 2,
      shutdownDriven: false,
    });
    expect(r.kind).toBe("transient");
    expect(r.detail).toBe("navigation_failed");
  });

  it("HarnessException(BLOCKED) @1 → transient (one-retry allowance)", () => {
    const r = classifyError(new HarnessException(HarnessError.BLOCKED, "b"), {
      attempt: 1,
      shutdownDriven: false,
    });
    expect(r.kind).toBe("transient");
    expect(r.detail).toBe("blocked");
  });

  it("HarnessException(BLOCKED) @2 → poison/blocked_after_retry", () => {
    const r = classifyError(new HarnessException(HarnessError.BLOCKED, "b"), {
      attempt: 2,
      shutdownDriven: false,
    });
    expect(r.kind).toBe("poison");
    expect(r.detail).toBe("blocked_after_retry");
  });

  it("HarnessException(CONSENT_WALL_UNRESOLVED) @1 → poison (always)", () => {
    const r = classifyError(new HarnessException(HarnessError.CONSENT_WALL_UNRESOLVED, "c"), {
      attempt: 1,
      shutdownDriven: false,
    });
    expect(r.kind).toBe("poison");
    expect(r.detail).toBe("consent_wall_unresolved");
  });

  it("plain Error('network') @1 → transient/unknown (default-retry)", () => {
    const r = classifyError(new Error("network"), { attempt: 1, shutdownDriven: false });
    expect(r.kind).toBe("transient");
    expect(r.detail).toBe("unknown");
    expect(r.retryAt).toBeDefined();
  });

  it("AbortError + shutdownDriven=true → transient/shutdown", () => {
    const abortErr = new DOMException("aborted", "AbortError");
    const r = classifyError(abortErr, { attempt: 1, shutdownDriven: true });
    expect(r.kind).toBe("transient");
    expect(r.detail).toBe("shutdown");
  });

  it("AbortError without shutdown flag → transient/abort", () => {
    const abortErr = new DOMException("aborted", "AbortError");
    const r = classifyError(abortErr, { attempt: 1, shutdownDriven: false });
    expect(r.kind).toBe("transient");
    expect(r.detail).toBe("abort");
  });

  it("ZodError → poison/profile_schema_invalid", () => {
    const r = classifyError(makeZodError(), { attempt: 1, shutdownDriven: false });
    expect(r.kind).toBe("poison");
    expect(r.detail).toBe("profile_schema_invalid");
  });

  it("attempt >= maxAttempts → poison/max_attempts_exhausted (overrides class)", () => {
    const r: NackReason = classifyError(new HarnessException(HarnessError.TIMEOUT, "t"), {
      attempt: 5,
      shutdownDriven: false,
    });
    expect(r.kind).toBe("poison");
    expect(r.detail).toBe("max_attempts_exhausted");
  });

  it("attempt >= maxAttempts dominates even for plain Error", () => {
    const r = classifyError(new Error("anything"), { attempt: 5, shutdownDriven: false });
    expect(r.kind).toBe("poison");
    expect(r.detail).toBe("max_attempts_exhausted");
  });
});
