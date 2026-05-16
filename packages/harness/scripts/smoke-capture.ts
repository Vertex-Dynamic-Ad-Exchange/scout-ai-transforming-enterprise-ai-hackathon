// Manual smoke for @scout/harness. NOT part of the test sweep — lives
// outside __tests__/ so vitest ignores it. Run with:
//   BROWSER_USE_API_KEY=... pnpm --filter @scout/harness run smoke
//   BROWSER_USE_API_KEY=... pnpm --filter @scout/harness run smoke -- --force-agent
//
// --force-agent (PRP-C1): exercises the Agent-mode path live; bypasses the
// two-pass orchestrator. Smoke-script only — never a production CLI surface
// (profiler invokes via opts.forceAgentMode).
//
// PRP-C2 (D5): URL 4 is a known-consent-wall page that exercises the
// two-pass Browser → Agent fallback on every smoke run. Expected output for
// URL 4: `mode: "agent"` + warnings includes
// `consent_wall_handled_via_agent_mode`. If URL 4 returns `mode: "browser"`
// either the heuristic missed (PRP-C1 consentWall.ts trade) or the page
// stopped walling (consent banners get A/B-tested off some surfaces) — try
// another EU news front, update the URL + verification date below, and add a
// note in the PR.
//
// SECURITY: never logs the full PageCapture (domText is up to 256 KiB of
// arbitrary page content). Logs the structured summary only.
import { createHarness } from "../src/factory.js";

// Hardcoded — NOT CLI args. The captured set is intentionally locked so the
// smoke output is comparable across runs. Edit this array in source.
//
// URL 4: theguardian.com — verified 2026-05-15 as serving a consent banner
// matching BANNER_SELECTORS (sourcepoint CMP, `[class*="consent"]`). The
// front page is the lowest-drift target; article slugs rotate, the homepage
// shell does not.
const URLS = [
  "https://en.wikipedia.org/wiki/Page_caching", // static article
  "https://news.ycombinator.com/", // SPA-ish, no <video>
  "https://www.bbc.com/news", // video-heavy news front
  "https://www.theguardian.com/", // known-consent-wall (PRP-C2 D5)
];

// PRP-C1 § smoke: when --force-agent is passed, drive only the static article
// URL through Agent mode. Limiting to one URL keeps cost bounded — the vendor
// LLM loop is ~5–10× the Browser-mode budget per page.
const AGENT_SMOKE_URL = "https://en.wikipedia.org/wiki/Page_caching";

interface Summary {
  url: string;
  mode: string;
  timeMs: number;
  screenshotCount: number;
  videoCount: number;
  contentHash: string;
  warnings: string[];
}

async function main(): Promise<void> {
  const forceAgent = process.argv.includes("--force-agent");
  const harness = createHarness();
  // Concurrency is the profiler's domain. Smoke runs sequentially so
  // browser-use Cloud rate limits never surface as flake here.
  const targets = forceAgent ? [AGENT_SMOKE_URL] : URLS;
  for (const url of targets) {
    const start = Date.now();
    try {
      const result = await harness.capturePage(url, forceAgent ? { forceAgentMode: true } : {});
      const line: Summary = {
        url,
        mode: result.capturedBy.mode,
        timeMs: Date.now() - start,
        screenshotCount: result.screenshots.length,
        videoCount: result.videoSamples.length,
        contentHash: result.contentHash,
        warnings: result.warnings,
      };
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(line));
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify({ url, error: err, timeMs: Date.now() - start }));
    }
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
