import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "@scout/shared";
import { chooseDegradation, costOf, createSpendWindow, recordSpend } from "../costTripwire.js";

const ENV_KEYS = [
  "PROFILER_COST_WINDOW_MS",
  "PROFILER_COST_WINDOW_SOFT",
  "PROFILER_COST_WINDOW_HARD",
];

function spyLogger(): Logger & { calls: { info: Record<string, unknown>[] } } {
  const infoCalls: Record<string, unknown>[] = [];
  return {
    info: (f) => {
      infoCalls.push(f);
    },
    warn: () => {},
    error: () => {},
    calls: { info: infoCalls },
  };
}

describe("costOf — D2 cost proxy fallback", () => {
  it("prefers usage.total_tokens when present", () => {
    expect(costOf({ usage: { total_tokens: 5_000 }, modelLatencyMs: 100 })).toBe(5_000);
  });

  it("falls back to modelLatencyMs when usage is null", () => {
    expect(costOf({ usage: null, modelLatencyMs: 100 })).toBe(100);
  });

  it("falls back to modelLatencyMs when usage is undefined (default AgentVerdict)", () => {
    expect(costOf({ modelLatencyMs: 42 })).toBe(42);
  });

  it("falls back when total_tokens is null inside usage", () => {
    expect(costOf({ usage: { total_tokens: null }, modelLatencyMs: 7 })).toBe(7);
  });
});

describe("chooseDegradation — floor (D3)", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("empty window + jobHint='drop_video' returns 'drop_video' (floor respected)", () => {
    const w = createSpendWindow();
    const logger = spyLogger();
    expect(chooseDegradation(w, "drop_video", 0, logger)).toBe("drop_video");
  });

  it("empty window + jobHint='collapse_text_image' returns 'collapse_text_image'", () => {
    const w = createSpendWindow();
    const logger = spyLogger();
    expect(chooseDegradation(w, "collapse_text_image", 0, logger)).toBe("collapse_text_image");
  });

  it("never downgrades — windowHint='none' under a higher jobHint stays at jobHint", () => {
    const w = createSpendWindow();
    const logger = spyLogger();
    // No samples → windowHint would be 'none' on its own; the floor (drop_video)
    // wins via maxHint.
    expect(chooseDegradation(w, "drop_video", 0, logger)).toBe("drop_video");
  });
});

describe("chooseDegradation — transition matrix (Task 6)", () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env["PROFILER_COST_WINDOW_MS"] = "60000";
    process.env["PROFILER_COST_WINDOW_SOFT"] = "8000";
    process.env["PROFILER_COST_WINDOW_HARD"] = "16000";
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("transitions through none → drop_video → collapse_text_image → none with eviction", () => {
    const w = createSpendWindow();
    const logger = spyLogger();

    // 7 samples × 1000 = 7000 ≤ soft (8000) → none. Strict ">" boundary.
    for (let i = 0; i < 7; i++) recordSpend(w, Date.now(), 1_000);
    expect(chooseDegradation(w, "none", Date.now(), logger)).toBe("none");
    expect(logger.calls.info).toHaveLength(0); // none → none, no transition log.

    // 8th sample → total 8000, strict ">" → still none.
    recordSpend(w, Date.now(), 1_000);
    expect(chooseDegradation(w, "none", Date.now(), logger)).toBe("none");
    expect(logger.calls.info).toHaveLength(0);

    // 9th sample → total 9000 > soft → drop_video. Transition logged.
    recordSpend(w, Date.now(), 1_000);
    expect(chooseDegradation(w, "none", Date.now(), logger)).toBe("drop_video");
    expect(logger.calls.info).toHaveLength(1);
    expect(logger.calls.info[0]).toEqual({
      event: "cost_tripwire_change",
      from: "none",
      to: "drop_video",
    });

    // Push past hard (16000). Add 8 × 1000 = 17000 total.
    for (let i = 0; i < 8; i++) recordSpend(w, Date.now(), 1_000);
    expect(chooseDegradation(w, "none", Date.now(), logger)).toBe("collapse_text_image");
    expect(logger.calls.info).toHaveLength(2);
    expect(logger.calls.info[1]).toEqual({
      event: "cost_tripwire_change",
      from: "drop_video",
      to: "collapse_text_image",
    });

    // Advance time past the window — all samples evict — back to none.
    vi.advanceTimersByTime(60_001);
    expect(chooseDegradation(w, "none", Date.now(), logger)).toBe("none");
    expect(logger.calls.info).toHaveLength(3);
    expect(logger.calls.info[2]).toEqual({
      event: "cost_tripwire_change",
      from: "collapse_text_image",
      to: "none",
    });
  });

  it("does not log transitions when hint is unchanged across multiple calls", () => {
    const w = createSpendWindow();
    const logger = spyLogger();
    for (let i = 0; i < 3; i++) {
      chooseDegradation(w, "none", Date.now(), logger);
    }
    expect(logger.calls.info).toHaveLength(0);
  });

  it("floor floors windowHint='none' upward to job's 'drop_video' WITHOUT logging windowHint", () => {
    const w = createSpendWindow();
    const logger = spyLogger();
    const result = chooseDegradation(w, "drop_video", Date.now(), logger);
    expect(result).toBe("drop_video");
    // First transition: none → drop_video logged (because lastHint started at none).
    expect(logger.calls.info).toHaveLength(1);
  });
});
