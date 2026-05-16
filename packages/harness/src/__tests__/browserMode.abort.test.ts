import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Per-file mocks per PRP-B2: no shared mock module.
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  stop: vi.fn(),
  connectOverCDP: vi.fn(),
}));

vi.mock("browser-use-sdk", () => ({
  BrowserUse: vi.fn().mockImplementation(() => ({
    browsers: { create: mocks.create, stop: mocks.stop },
  })),
}));

vi.mock("playwright", () => ({
  chromium: { connectOverCDP: mocks.connectOverCDP },
}));

import { HarnessError, HarnessException } from "@scout/shared";
import { createHarness } from "../factory.js";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("BROWSER_USE_API_KEY", "test-key");
  mocks.create.mockReset();
  mocks.stop.mockReset().mockResolvedValue({});
  mocks.connectOverCDP
    .mockReset()
    .mockRejectedValue(new Error("connectOverCDP should not be called in this test"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("capturePage — D6 Path B (AbortSignal experiment)", () => {
  // PRP-B2 D6: SDK source (browser-use-sdk@3.6.0) has no AbortSignal passthrough
  // on browsers.create — verified upstream. We commit to Path B:
  // Promise.race-style timeout + late-resolve orphan cleanup. Recorded in
  // the PR description.

  it("throws HarnessError.TIMEOUT within the budget when SDK create exceeds it", async () => {
    const lateSession = {
      id: "sess-late",
      status: "active",
      cdpUrl: "ws://fake",
      liveUrl: null,
      timeoutAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      proxyUsedMb: "0",
      proxyCost: "0",
      browserCost: "0",
    };
    mocks.create.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(lateSession), 200)),
    );

    const start = Date.now();
    let thrown: unknown;
    try {
      await createHarness().capturePage("https://example.test/article", { timeoutMs: 50 });
    } catch (e) {
      thrown = e;
    }
    const elapsed = Date.now() - start;

    expect(thrown).toBeInstanceOf(HarnessException);
    expect((thrown as HarnessException).code).toBe(HarnessError.TIMEOUT);
    // 50ms budget + 100ms slack. Tight enough to catch a regression where the
    // Promise.race times out only AFTER the SDK call completes.
    expect(elapsed).toBeLessThan(150);
    expect(mocks.connectOverCDP).not.toHaveBeenCalled();
  });

  it("orphan-cleans the cloud session when SDK create resolves AFTER the timeout fires", async () => {
    const lateSession = {
      id: "sess-late",
      status: "active",
      cdpUrl: "ws://fake",
      liveUrl: null,
      timeoutAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      proxyUsedMb: "0",
      proxyCost: "0",
      browserCost: "0",
    };
    mocks.create.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(lateSession), 100)),
    );

    let thrown: unknown;
    try {
      await createHarness().capturePage("https://example.test/article", { timeoutMs: 30 });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as HarnessException).code).toBe(HarnessError.TIMEOUT);

    // Wait long enough for the SDK promise to settle.
    await new Promise((r) => setTimeout(r, 200));

    // Late-resolve cleanup: orphaned session got stopped with the late id.
    // Even if the finally block ran without a sessionId, the onResolve
    // handler captured the late one and stopped it.
    expect(mocks.stop).toHaveBeenCalledWith("sess-late");
  });

  it("does NOT emit an unhandledRejection when the SDK promise late-rejects after timeout", async () => {
    // Cost trip-wire: a late SDK reject must not leak. The .then(_, onReject)
    // handler swallows it once `settled` is true.
    mocks.create.mockImplementation(
      () =>
        new Promise((_, reject) => setTimeout(() => reject(new Error("late SDK failure")), 100)),
    );

    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    let thrown: unknown;
    try {
      await createHarness().capturePage("https://example.test/article", { timeoutMs: 30 });
    } catch (e) {
      thrown = e;
    }
    expect((thrown as HarnessException).code).toBe(HarnessError.TIMEOUT);

    // 50ms past the SDK reject (100ms) — late rejection has settled.
    await new Promise((r) => setTimeout(r, 200));

    expect(unhandled).not.toHaveBeenCalled();
    process.off("unhandledRejection", unhandled);
  });
});
