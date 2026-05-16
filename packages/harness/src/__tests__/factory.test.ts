import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessError, HarnessException, type Harness, type PageCapture } from "@scout/shared";

// PRP-C1 Task 4 (T4a): the factory now has a forceAgentMode branch. Mock the
// two mode drivers as separate modules so we can pin "exactly one was called"
// without invoking the real Browser-mode pipeline (which would need the SDK +
// Playwright fakes). Mocks are hoisted so they apply before the factory
// imports them.
const mocks = vi.hoisted(() => ({
  captureViaBrowser: vi.fn(),
  captureViaAgent: vi.fn(),
}));

vi.mock("../browserMode.js", () => ({
  capturePage: mocks.captureViaBrowser,
}));

vi.mock("../agentMode.js", () => ({
  captureViaAgent: mocks.captureViaAgent,
}));

import { createHarness } from "../factory.js";

describe("createHarness()", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.captureViaBrowser.mockReset();
    mocks.captureViaAgent.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns an object satisfying the Harness interface", () => {
    vi.stubEnv("BROWSER_USE_API_KEY", "test-key");

    // The type annotation pins `satisfies Harness` at compile time — drift
    // between factory shape and the @scout/shared interface fails the build,
    // not just the test.
    const harness: Harness = createHarness();
    expect(typeof harness.capturePage).toBe("function");
  });

  it("throws HarnessException(UPSTREAM_DOWN) when BROWSER_USE_API_KEY is not set", () => {
    vi.stubEnv("BROWSER_USE_API_KEY", "");

    let thrown: unknown;
    try {
      createHarness();
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(HarnessException);
    expect((thrown as HarnessException).code).toBe(HarnessError.UPSTREAM_DOWN);
  });

  it("T4a — forceAgentMode:true routes to captureViaAgent; captureViaBrowser is never called", async () => {
    vi.stubEnv("BROWSER_USE_API_KEY", "test-key");
    // Return value shape is irrelevant — the test only pins routing.
    mocks.captureViaAgent.mockResolvedValue({} as PageCapture);

    await createHarness().capturePage("https://example.test/", { forceAgentMode: true });

    expect(mocks.captureViaAgent).toHaveBeenCalledTimes(1);
    expect(mocks.captureViaBrowser).not.toHaveBeenCalled();
  });

  it("T4a — forceAgentMode:false (default) routes to captureViaBrowser; captureViaAgent untouched", async () => {
    vi.stubEnv("BROWSER_USE_API_KEY", "test-key");
    mocks.captureViaBrowser.mockResolvedValue({} as PageCapture);

    await createHarness().capturePage("https://example.test/");

    expect(mocks.captureViaBrowser).toHaveBeenCalledTimes(1);
    expect(mocks.captureViaAgent).not.toHaveBeenCalled();
  });
});
