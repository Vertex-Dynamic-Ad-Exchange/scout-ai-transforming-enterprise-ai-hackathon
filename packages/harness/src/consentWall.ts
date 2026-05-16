import type { Page } from "playwright";

// PRP-C1 D4: static selector list + content-starvation floor. False positives
// cost an extra Agent round-trip; false negatives surface as a low-quality
// Browser-mode capture. This is the v1 trade — expand the selector list if
// smoke surfaces missed banners.
//
// Keep BANNER_SELECTORS literal. A dynamic selector list would re-open the
// page-injection vector that this module exists to close at the navigation
// seam.
const BANNER_SELECTORS = [
  "#onetrust-banner-sdk",
  '[id*="cookie-banner"]',
  '[class*="consent"]',
  '[class*="cookie-notice"]',
  '[data-testid*="cookie"]',
] as const;

const MIN_BODY_TEXT_CHARS = 200;

export async function detectConsentWall(page: Page): Promise<boolean> {
  for (const sel of BANNER_SELECTORS) {
    if ((await page.$$(sel)).length > 0) return true;
  }
  // Reason: even when no banner selector matches, modal-style overlays often
  // hijack the viewport and reduce body innerText to a stub. The 200-char
  // floor catches those without parsing CSS.
  const len = await page.evaluate(() => (document.body?.innerText ?? "").length);
  return len < MIN_BODY_TEXT_CHARS;
}
