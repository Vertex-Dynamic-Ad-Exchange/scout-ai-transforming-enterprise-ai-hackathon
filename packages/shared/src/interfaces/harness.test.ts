import { describe, expect, it } from "vitest";
import { HarnessError, HarnessException, type Harness, type PageCapture } from "@scout/shared";

describe("Harness interface — compile-time assignability", () => {
  it("accepts an impl with the documented capturePage signature", () => {
    const impl: Harness = {
      capturePage: async () => ({}) as PageCapture,
    };
    expect(typeof impl.capturePage).toBe("function");
  });
});

describe("HarnessException — runtime shape", () => {
  it("is instanceof Error and HarnessException", () => {
    const err = new HarnessException(HarnessError.TIMEOUT, "boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(HarnessException);
  });

  it("carries the code, message, and a named class", () => {
    const err = new HarnessException(HarnessError.NAVIGATION_FAILED, "nav failed");
    expect(err.code).toBe("NAVIGATION_FAILED");
    expect(err.message).toBe("nav failed");
    expect(err.name).toBe("HarnessException");
  });

  it("preserves the cause when provided", () => {
    const inner = new Error("inner");
    const err = new HarnessException(HarnessError.UPSTREAM_DOWN, "x", inner);
    expect(err.cause).toBe(inner);
  });
});

describe("HarnessError enum — integrity", () => {
  it("has exactly 5 unique string values", () => {
    const values = Object.values(HarnessError);
    expect(values).toHaveLength(5);
    expect(new Set(values).size).toBe(5);
    for (const v of values) {
      expect(typeof v).toBe("string");
    }
  });

  it("every key matches its string value (as-const pattern)", () => {
    for (const [key, value] of Object.entries(HarnessError)) {
      expect(value).toBe(key);
    }
  });

  it("includes the five documented codes", () => {
    expect(HarnessError).toMatchObject({
      TIMEOUT: "TIMEOUT",
      NAVIGATION_FAILED: "NAVIGATION_FAILED",
      BLOCKED: "BLOCKED",
      CONSENT_WALL_UNRESOLVED: "CONSENT_WALL_UNRESOLVED",
      UPSTREAM_DOWN: "UPSTREAM_DOWN",
    });
  });
});
