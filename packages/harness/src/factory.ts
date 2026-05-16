import { BrowserUse } from "browser-use-sdk";
import type { Harness } from "@scout/shared";
import { harnessConfig } from "./config.js";
import { capturePage } from "./browserMode.js";

// Mirrors the @scout/llm-client factory pattern (PRPs/foundation-ad-verification.md:175-202):
// pull config once, construct SDK with explicit apiKey (never relying on the
// SDK's implicit env fallback — that path bypasses our single-source config audit).
export function createHarness(): Harness {
  const cfg = harnessConfig();
  const sdk = new BrowserUse({
    apiKey: cfg.browserUseApiKey,
    ...(cfg.browserUseBaseUrl ? { baseUrl: cfg.browserUseBaseUrl } : {}),
  });
  return {
    capturePage: (url, opts) => capturePage(sdk, cfg, url, opts),
  } satisfies Harness;
}
