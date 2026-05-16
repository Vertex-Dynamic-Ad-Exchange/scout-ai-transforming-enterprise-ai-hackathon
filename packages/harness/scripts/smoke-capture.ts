// Manual smoke for @scout/harness. NOT part of the test sweep — lives
// outside __tests__/ so vitest ignores it. Run with:
//   BROWSER_USE_API_KEY=... pnpm --filter @scout/harness run smoke
//
// SECURITY: never logs the full PageCapture (domText is up to 256 KiB of
// arbitrary page content). Logs the structured summary only.
import { createHarness } from "../src/factory.js";

// Hardcoded — NOT CLI args. The captured set is intentionally locked so the
// smoke output is comparable across runs. Edit this array in source.
const URLS = [
  "https://en.wikipedia.org/wiki/Page_caching", // static article
  "https://news.ycombinator.com/", // SPA-ish, no <video>
  "https://www.bbc.com/news", // video-heavy news front
];

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
  const harness = createHarness();
  // Concurrency is the profiler's domain. Smoke runs sequentially so
  // browser-use Cloud rate limits never surface as flake here.
  for (const url of URLS) {
    const start = Date.now();
    try {
      const result = await harness.capturePage(url);
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
