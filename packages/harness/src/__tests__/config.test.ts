import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessError, HarnessException } from "@scout/shared";
import { harnessConfig } from "../config.js";

describe("harnessConfig()", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("happy path", () => {
    it("returns the key + defaultProxyCountry US when BROWSER_USE_API_KEY is set", () => {
      vi.stubEnv("BROWSER_USE_API_KEY", "test-key");
      vi.stubEnv("BROWSER_USE_BASE_URL", "");

      const cfg = harnessConfig();

      expect(cfg.browserUseApiKey).toBe("test-key");
      expect(cfg.defaultProxyCountry).toBe("US");
    });

    it("threads BROWSER_USE_BASE_URL through when set", () => {
      vi.stubEnv("BROWSER_USE_API_KEY", "test-key");
      vi.stubEnv("BROWSER_USE_BASE_URL", "https://staging.browser-use.test");

      const cfg = harnessConfig();

      expect(cfg.browserUseBaseUrl).toBe("https://staging.browser-use.test");
    });
  });

  describe("failure — missing API key", () => {
    it("throws HarnessException with code UPSTREAM_DOWN when BROWSER_USE_API_KEY is not set", () => {
      vi.stubEnv("BROWSER_USE_API_KEY", "");

      let thrown: unknown;
      try {
        harnessConfig();
      } catch (e) {
        thrown = e;
      }

      expect(thrown).toBeInstanceOf(HarnessException);
      expect((thrown as HarnessException).code).toBe(HarnessError.UPSTREAM_DOWN);
    });
  });

  describe("security — error message does not leak the env-var value", () => {
    it("does not include any value-bearing token in the message", () => {
      vi.stubEnv("BROWSER_USE_API_KEY", "");

      let thrown: unknown;
      try {
        harnessConfig();
      } catch (e) {
        thrown = e;
      }

      const message = (thrown as Error).message;
      // The variable NAME may appear as a hint; any "=value" leakage (even redacted) may not.
      expect(message).not.toMatch(/BROWSER_USE_API_KEY=\S/);
    });
  });
});
