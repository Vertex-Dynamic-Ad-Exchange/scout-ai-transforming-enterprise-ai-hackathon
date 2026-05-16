import { BrowserUse } from "browser-use-sdk";
import type { Harness } from "@scout/shared";
import { harnessConfig } from "./config.js";
import { capturePage } from "./capture.js";

// Mirrors the @scout/llm-client factory pattern (PRPs/foundation-ad-verification.md:175-202):
// pull config once, construct SDK with explicit apiKey (never relying on the
// SDK's implicit env fallback — that path bypasses our single-source config audit).
//
// PRP-C2: single delegate to capture.ts. Mode routing (forceAgentMode) and the
// two-pass Browser → Agent fallback live there. This file only owns config +
// SDK construction.
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
