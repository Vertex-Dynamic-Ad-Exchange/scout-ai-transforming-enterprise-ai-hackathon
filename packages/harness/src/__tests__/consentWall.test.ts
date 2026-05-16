import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { detectConsentWall } from "../consentWall.js";

// Build a fake Page typed against playwright.Page that only implements the two
// methods consentWall.ts actually touches: .$$ and .evaluate. The cast is
// scoped to the fixture so production typing isn't relaxed.
function fakePage(opts: { hits?: Record<string, number>; bodyTextLength: number }): Page {
  const $$ = vi.fn(async (sel: string) => {
    const count = opts.hits?.[sel] ?? 0;
    return Array.from({ length: count }, () => ({}));
  });
  const evaluate = vi.fn(async () => opts.bodyTextLength);
  return { $$, evaluate } as unknown as Page;
}

describe("detectConsentWall", () => {
  it("T1a — banner ID hit (#onetrust-banner-sdk) short-circuits to true", async () => {
    const page = fakePage({ hits: { "#onetrust-banner-sdk": 1 }, bodyTextLength: 5000 });
    expect(await detectConsentWall(page)).toBe(true);
  });

  it('T1b — generic class selector hit ([class*="consent"]) returns true', async () => {
    const page = fakePage({
      hits: { '[class*="consent"]': 1 },
      bodyTextLength: 5000,
    });
    expect(await detectConsentWall(page)).toBe(true);
  });

  it("T1c — content starvation (innerText < 200 chars) returns true", async () => {
    const page = fakePage({ bodyTextLength: 5 });
    expect(await detectConsentWall(page)).toBe(true);
  });

  it("T1d — normal page (no banner, 5000 chars body) returns false", async () => {
    const page = fakePage({ bodyTextLength: 5000 });
    expect(await detectConsentWall(page)).toBe(false);
  });
});
