import type { Page } from "playwright";

// SECURITY: keep VOLATILE_SELECTORS as a static array. The strip runs inside
// page.evaluate so the selectors travel as a DATA argument — never as
// interpolated source. A dynamic selector list would re-open the
// page-side-injection vector this module exists to close.
export const VOLATILE_SELECTORS = [
  "time[datetime]",
  '[data-testid^="ad-slot-"]',
  'meta[name="csrf-token"]',
] as const;

export interface DomExtract {
  readonly domText: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly ogType: string | null;
  readonly lang: string | null;
  readonly headline: string | null;
}

export async function extractFromPage(page: Page): Promise<DomExtract> {
  // Single round-trip: strip volatile DOM, then read innerText + headline +
  // metadata in one evaluate. Saves ~3× the CDP round-trip cost vs one
  // call per field, which matters at sub-second budget.
  return (await page.evaluate(
    (selectors: readonly string[]) => {
      for (const sel of selectors) {
        document.querySelectorAll(sel).forEach((el) => el.remove());
      }
      const metaContent = (name: string): string | null => {
        const el = document.querySelector(`meta[name="${name}"]`);
        return el instanceof HTMLMetaElement ? el.content || null : null;
      };
      const ogContent = (prop: string): string | null => {
        const el = document.querySelector(`meta[property="${prop}"]`);
        return el instanceof HTMLMetaElement ? el.content || null : null;
      };
      const h1 = document.querySelector("h1");
      return {
        domText: document.body?.innerText ?? "",
        title: document.title || null,
        description: metaContent("description") ?? ogContent("og:description"),
        ogType: ogContent("og:type"),
        lang: document.documentElement.lang || null,
        headline: (h1?.textContent ?? "").trim() || null,
      };
    },
    [...VOLATILE_SELECTORS],
  )) as DomExtract;
}
