import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDemoGateUrl } from "@scout/demo";

const ENV_KEY = "DEMO_GATE_URL";

describe("getDemoGateUrl (D10)", () => {
  let originalValue: string | undefined;

  beforeEach(() => {
    originalValue = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalValue;
    }
  });

  it("defaults to http://localhost:3000 when env is unset", () => {
    delete process.env[ENV_KEY];
    expect(getDemoGateUrl()).toBe("http://localhost:3000");
  });

  it("returns the env value verbatim when set to a valid URL", () => {
    process.env[ENV_KEY] = "https://gate.example.com";
    expect(getDemoGateUrl()).toBe("https://gate.example.com");
  });

  it("throws ZodError when env value is not a URL", () => {
    process.env[ENV_KEY] = "not-a-url";
    expect(() => getDemoGateUrl()).toThrow();
  });
});
