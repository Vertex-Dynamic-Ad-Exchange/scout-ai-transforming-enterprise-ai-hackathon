import { describe, expect, it } from "vitest";
import { CaptureOptionsSchema, PageCaptureSchema } from "@scout/shared";

const VALID_PAGE_CAPTURE = {
  url: "https://example.test/article",
  requestedUrl: "https://example.test/article",
  contentHash: "a".repeat(64),
  capturedAt: "2026-05-15T10:00:00.000Z",
  geo: "US",
  domText: "Hello world.",
  headline: "Hello world",
  metadata: {
    title: "Example",
    description: "An example page.",
    ogType: "article",
    lang: "en",
  },
  screenshots: [
    {
      uri: "file:///tmp/scout-evidence/abc/0.png",
      kind: "above_fold" as const,
      scrollY: 0,
      viewport: { w: 1280, h: 800 },
      bytes: 12345,
    },
  ],
  videoSamples: [],
  capturedBy: {
    mode: "browser" as const,
    sdkVersion: "browser-use-sdk@2.0.0",
    sessionId: "sess-1",
  },
  warnings: [],
};

const valid = (): typeof VALID_PAGE_CAPTURE =>
  JSON.parse(JSON.stringify(VALID_PAGE_CAPTURE)) as typeof VALID_PAGE_CAPTURE;

describe("PageCaptureSchema (happy path)", () => {
  it("parses a hand-built valid PageCapture literal", () => {
    const parsed = PageCaptureSchema.parse(VALID_PAGE_CAPTURE);
    expect(parsed.url).toBe("https://example.test/article");
    expect(parsed.contentHash).toHaveLength(64);
    expect(parsed.screenshots).toHaveLength(1);
  });
});

describe("PageCaptureSchema — contentHash regex", () => {
  it("accepts exactly 64 lowercase hex chars", () => {
    const input = { ...valid(), contentHash: "0123456789abcdef".repeat(4) };
    expect(() => PageCaptureSchema.parse(input)).not.toThrow();
  });

  it("rejects 63-char hash", () => {
    const input = { ...valid(), contentHash: "a".repeat(63) };
    expect(() => PageCaptureSchema.parse(input)).toThrow();
  });

  it("rejects 65-char hash", () => {
    const input = { ...valid(), contentHash: "a".repeat(65) };
    expect(() => PageCaptureSchema.parse(input)).toThrow();
  });

  it("rejects uppercase hex (case-sensitive)", () => {
    const input = { ...valid(), contentHash: "X".repeat(64) };
    expect(() => PageCaptureSchema.parse(input)).toThrow();
  });
});

describe("PageCaptureSchema — domText byte cap", () => {
  it("accepts domText of exactly 256 * 1024 chars", () => {
    const input = { ...valid(), domText: "a".repeat(256 * 1024) };
    expect(() => PageCaptureSchema.parse(input)).not.toThrow();
  });

  it("rejects domText of 256 * 1024 + 1 chars", () => {
    const input = { ...valid(), domText: "a".repeat(256 * 1024 + 1) };
    expect(() => PageCaptureSchema.parse(input)).toThrow();
  });
});

describe("PageCaptureSchema — collections and nullability", () => {
  it("rejects empty screenshots array", () => {
    const input = { ...valid(), screenshots: [] };
    expect(() => PageCaptureSchema.parse(input)).toThrow();
  });

  it("rejects null videoSamples (must be array)", () => {
    const input = { ...valid(), videoSamples: null };
    expect(() => PageCaptureSchema.parse(input)).toThrow();
  });

  it("rejects undefined headline (must be string | null, explicit)", () => {
    const input: Record<string, unknown> = { ...valid() };
    delete input["headline"];
    expect(() => PageCaptureSchema.parse(input)).toThrow();
  });
});

describe("PageCaptureSchema — capturedBy.mode enum", () => {
  it("accepts mode: 'agent'", () => {
    const input = {
      ...valid(),
      capturedBy: { ...VALID_PAGE_CAPTURE.capturedBy, mode: "agent" as const },
    };
    expect(() => PageCaptureSchema.parse(input)).not.toThrow();
  });

  it("rejects mode: 'AGENT' (case-sensitive)", () => {
    const input = {
      ...valid(),
      capturedBy: { ...VALID_PAGE_CAPTURE.capturedBy, mode: "AGENT" },
    };
    expect(() => PageCaptureSchema.parse(input)).toThrow();
  });
});

describe("PageCaptureSchema — geo alpha-2", () => {
  it("accepts 'DE'", () => {
    const input = { ...valid(), geo: "DE" };
    expect(() => PageCaptureSchema.parse(input)).not.toThrow();
  });

  it("rejects 'de' (lowercase)", () => {
    const input = { ...valid(), geo: "de" };
    expect(() => PageCaptureSchema.parse(input)).toThrow();
  });

  it("rejects 'DEU' (alpha-3)", () => {
    const input = { ...valid(), geo: "DEU" };
    expect(() => PageCaptureSchema.parse(input)).toThrow();
  });
});

describe("PageCaptureSchema — url vs. requestedUrl", () => {
  it("accepts a post-redirect case where url and requestedUrl differ", () => {
    const input = {
      ...valid(),
      requestedUrl: "https://example.test/a",
      url: "https://example.test/b",
    };
    const parsed = PageCaptureSchema.parse(input);
    expect(parsed.requestedUrl).toBe("https://example.test/a");
    expect(parsed.url).toBe("https://example.test/b");
  });

  it("rejects a malformed requestedUrl", () => {
    const input = { ...valid(), requestedUrl: "not-a-url" };
    expect(() => PageCaptureSchema.parse(input)).toThrow();
  });

  it("rejects a malformed url", () => {
    const input = { ...valid(), url: "not-a-url" };
    expect(() => PageCaptureSchema.parse(input)).toThrow();
  });
});

describe("PageCaptureSchema — total failures", () => {
  it("throws on parse(null)", () => {
    expect(() => PageCaptureSchema.parse(null)).toThrow();
  });

  it("throws on parse({}) with multiple zod issues", () => {
    const result = PageCaptureSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(1);
    }
  });
});

describe("PageCaptureSchema — determinism", () => {
  it("parses twice and yields deep-equal results (no hidden mutation)", () => {
    const a = PageCaptureSchema.parse(VALID_PAGE_CAPTURE);
    const b = PageCaptureSchema.parse(VALID_PAGE_CAPTURE);
    expect(a).toEqual(b);
    // The input must not have been mutated.
    expect(VALID_PAGE_CAPTURE.warnings).toEqual([]);
  });
});

describe("CaptureOptionsSchema — happy", () => {
  it("parses an empty object", () => {
    expect(CaptureOptionsSchema.parse({})).toEqual({});
  });

  it("accepts uppercase geo 'DE'", () => {
    expect(CaptureOptionsSchema.parse({ geo: "DE" })).toEqual({ geo: "DE" });
  });
});

describe("CaptureOptionsSchema — sampleScrolls boundary", () => {
  it("accepts 0", () => {
    expect(() => CaptureOptionsSchema.parse({ sampleScrolls: 0 })).not.toThrow();
  });

  it("accepts 8", () => {
    expect(() => CaptureOptionsSchema.parse({ sampleScrolls: 8 })).not.toThrow();
  });

  it("rejects 9", () => {
    expect(() => CaptureOptionsSchema.parse({ sampleScrolls: 9 })).toThrow();
  });

  it("rejects -1", () => {
    expect(() => CaptureOptionsSchema.parse({ sampleScrolls: -1 })).toThrow();
  });
});

describe("CaptureOptionsSchema — .strict() rejects unknown keys", () => {
  it("rejects { unknownKey: 1 }", () => {
    expect(() => CaptureOptionsSchema.parse({ unknownKey: 1 })).toThrow();
  });
});

describe("CaptureOptionsSchema — timeoutMs positive", () => {
  it("rejects 0", () => {
    expect(() => CaptureOptionsSchema.parse({ timeoutMs: 0 })).toThrow();
  });

  it("accepts 1", () => {
    expect(() => CaptureOptionsSchema.parse({ timeoutMs: 1 })).not.toThrow();
  });
});

describe("CaptureOptionsSchema — viewport positive", () => {
  it("rejects { viewport: { w: 0, h: 800 } }", () => {
    expect(() => CaptureOptionsSchema.parse({ viewport: { w: 0, h: 800 } })).toThrow();
  });

  it("accepts { viewport: { w: 1280, h: 800 } }", () => {
    expect(() => CaptureOptionsSchema.parse({ viewport: { w: 1280, h: 800 } })).not.toThrow();
  });
});
