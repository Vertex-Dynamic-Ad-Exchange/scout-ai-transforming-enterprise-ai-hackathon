import type { Page } from "playwright";
import type { Screenshot } from "@scout/shared";
import { STORAGE_PLACEHOLDER, writeScreenshot } from "./storage.js";

export interface Viewport {
  readonly w: number;
  readonly h: number;
}

// Above-fold + N viewport-scroll samples. Sample order is deterministic
// (above_fold, then increasing scrollY) so verifier batching can rely on
// index → position. PRP-B2 D1.
export async function captureScreenshots(
  page: Page,
  callDir: string,
  viewport: Viewport,
  sampleScrolls: number,
): Promise<Screenshot[]> {
  const shots: Screenshot[] = [];
  const aboveFold = (await page.screenshot()) as Buffer;
  shots.push(
    await writeScreenshot(callDir, STORAGE_PLACEHOLDER, 0, aboveFold, {
      kind: "above_fold",
      scrollY: 0,
      viewport,
    }),
  );
  for (let i = 1; i <= sampleScrolls; i += 1) {
    await page.evaluate((h: number) => window.scrollBy(0, h), viewport.h);
    // Reason: 150ms is the empirical settle window after scrollBy that lets
    // lazy-loaded images paint before screenshot. Lower → blank tiles; higher
    // → wastes hot-path budget on every capture.
    await page.waitForTimeout(150);
    const shot = (await page.screenshot()) as Buffer;
    shots.push(
      await writeScreenshot(callDir, STORAGE_PLACEHOLDER, i, shot, {
        kind: "viewport_sample",
        scrollY: viewport.h * i,
        viewport,
      }),
    );
  }
  return shots;
}
