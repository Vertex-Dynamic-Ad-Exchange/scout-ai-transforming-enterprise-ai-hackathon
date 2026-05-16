import type { BrowserUse } from "browser-use-sdk";
import {
  CaptureOptionsSchema,
  HarnessError,
  HarnessException,
  type CaptureOptions,
  type HarnessErrorCode,
  type PageCapture,
} from "@scout/shared";
import type { HarnessConfig } from "./config.js";
import { capturePage as captureViaBrowser } from "./browserMode.js";
import { captureViaAgent } from "./agentMode.js";

// D1: only these two codes trigger the Agent retry. TIMEOUT and
// NAVIGATION_FAILED do NOT retry — retrying would either compound the latency
// cost (TIMEOUT) or push a malformed URL/content-type through a second cloud
// session (NAVIGATION_FAILED). Pinned by T1d + T1e in capture.test.ts.
const FALLBACK_CODES = new Set<HarnessErrorCode>([
  HarnessError.BLOCKED,
  HarnessError.CONSENT_WALL_UNRESOLVED,
]);

// D2 verbatim — the profiler reads this string to attribute the path that
// produced the capture. Renames here break observability. T1b/T1c pin it.
const FALLBACK_WARNING = "consent_wall_handled_via_agent_mode";

/**
 * Two-pass Browser → Agent orchestrator. Single entry point for `Harness.capturePage`:
 * `factory.ts` delegates here so option-parsing and mode-routing live in one place.
 *
 * @see features/clusterB/harness-capture-page.md — Agent-mode escape hatch
 */
export async function capturePage(
  sdk: BrowserUse,
  cfg: HarnessConfig,
  url: string,
  rawOpts: CaptureOptions = {},
): Promise<PageCapture> {
  // Single parse site. .strict() rejects unknown keys (e.g. misspelled
  // `geoLocation`) here so a silent passthrough cannot route every capture
  // through the US proxy. Browser/Agent impls trust the shape downstream.
  const opts = CaptureOptionsSchema.parse(rawOpts);

  // D3: forceAgentMode bypasses Browser entirely — it is a direct path, not
  // a fallback, so no FALLBACK_WARNING is emitted (T1g pin).
  if (opts.forceAgentMode) return captureViaAgent(sdk, cfg, url, opts);

  try {
    return await captureViaBrowser(sdk, cfg, url, opts);
  } catch (err) {
    const code = err instanceof HarnessException ? err.code : undefined;
    if (!code || !FALLBACK_CODES.has(code)) throw err;

    // D4: if Agent also throws, the Agent-mode error is what the caller sees.
    // The Browser-mode error is intentionally lost (would be debug-logged if a
    // tracer existed; not added here per scope).
    const out = await captureViaAgent(sdk, cfg, url, opts);
    out.warnings.push(FALLBACK_WARNING);
    return out;
  }
}
