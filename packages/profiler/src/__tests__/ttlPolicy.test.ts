import { describe, expect, it } from "vitest";
import type { PageCapture } from "@scout/shared";
import { computeTtl } from "../ttlPolicy.js";

const NEWS = 1_800;
const UGC = 600;
const DEFAULT = 21_600;

function cap(over: { url: string; ogType: string | null }): PageCapture {
  return {
    url: over.url,
    requestedUrl: over.url,
    contentHash: "a".repeat(64),
    capturedAt: "2026-05-16T00:00:00.000Z",
    geo: "US",
    domText: "",
    headline: null,
    metadata: { title: null, description: null, ogType: over.ogType, lang: "en" },
    screenshots: [
      {
        uri: "https://cdn.test/shot.png",
        kind: "above_fold",
        scrollY: 0,
        viewport: { w: 1280, h: 720 },
        bytes: 1,
      },
    ],
    videoSamples: [],
    capturedBy: { mode: "browser", sdkVersion: "3.6.0", sessionId: "s" },
    warnings: [],
  };
}

describe("computeTtl", () => {
  // PRP-D Task 2: table-driven heuristic per feature lines 93-97 + D12.
  it.each([
    ["og:article → news", { url: "https://example.com/", ogType: "article" }, NEWS],
    ["og:news → news", { url: "https://cnn.com/headline", ogType: "news" }, NEWS],
    [
      "og:video.movie → news (startsWith)",
      { url: "https://example.com/", ogType: "video.movie" },
      NEWS,
    ],
    [
      "og:video.episode → news (startsWith)",
      { url: "https://example.com/", ogType: "video.episode" },
      NEWS,
    ],
    ["null og + reddit host → ugc", { url: "https://www.reddit.com/r/foo", ogType: null }, UGC],
    ["null og + x.com host → ugc", { url: "https://x.com/some/post", ogType: null }, UGC],
    [
      "null og + youtube.com/shorts path → ugc (D12 path-aware)",
      { url: "https://www.youtube.com/shorts/abc123", ogType: null },
      UGC,
    ],
    [
      "null og + example.com/reddit path → DEFAULT (D12 negative)",
      { url: "https://example.com/reddit", ogType: null },
      DEFAULT,
    ],
    [
      "null og + plain example.com → default",
      { url: "https://example.com/", ogType: null },
      DEFAULT,
    ],
    [
      "null og + news.example.com host (not og:news, not UGC) → default",
      { url: "https://news.example.com/foo", ogType: null },
      DEFAULT,
    ],
  ])("%s", (_label, input, expected) => {
    expect(computeTtl(cap(input))).toBe(expected);
  });

  it("returns default when capture.url cannot be parsed (defensive)", () => {
    // PageCapture schema enforces URL on the wire, but the helper is defensive:
    // a parse-throw goes to the default branch, not propagating an exception.
    const broken = cap({ url: "https://example.com/", ogType: null });
    // Override post-build to bypass the zod schema in this unit boundary test.
    (broken as { url: string }).url = "not a url";
    expect(computeTtl(broken)).toBe(DEFAULT);
  });
});
