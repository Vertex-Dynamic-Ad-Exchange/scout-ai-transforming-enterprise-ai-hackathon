import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessError, HarnessException, type Harness } from "@scout/shared";
import { createHarness } from "../factory.js";

describe("createHarness()", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
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
});
