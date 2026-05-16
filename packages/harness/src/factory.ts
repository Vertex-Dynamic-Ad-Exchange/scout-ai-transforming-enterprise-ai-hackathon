import { BrowserUse } from "browser-use-sdk";
import type { Harness } from "@scout/shared";
import { harnessConfig } from "./config.js";
import { capturePage as captureViaBrowser } from "./browserMode.js";
import { captureViaAgent } from "./agentMode.js";

// Mirrors the @scout/llm-client factory pattern (PRPs/foundation-ad-verification.md:175-202):
// pull config once, construct SDK with explicit apiKey (never relying on the
// SDK's implicit env fallback — that path bypasses our single-source config audit).
//
// PRP-C1 D6: interim forceAgentMode routing. PRP-C2 replaces this with a single
// delegate to capture.ts (two-pass Browser → Agent on BLOCKED / CONSENT_WALL_UNRESOLVED).
export function createHarness(): Harness {
  const cfg = harnessConfig();
  const sdk = new BrowserUse({
    apiKey: cfg.browserUseApiKey,
    ...(cfg.browserUseBaseUrl ? { baseUrl: cfg.browserUseBaseUrl } : {}),
  });
  return {
    capturePage: (url, opts) => {
      if (opts?.forceAgentMode) return captureViaAgent(sdk, cfg, url, opts);
      return captureViaBrowser(sdk, cfg, url, opts);
    },
  } satisfies Harness;
}
