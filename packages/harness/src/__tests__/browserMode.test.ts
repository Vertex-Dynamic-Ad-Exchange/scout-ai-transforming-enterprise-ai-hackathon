import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted lets us share mock fns between the vi.mock factories below and
// the per-test setup. Mocks are scoped to this file — PRP-B2 forbids a
// shared mock module.
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  stop: vi.fn(),
  connectOverCDP: vi.fn(),
}));

vi.mock("browser-use-sdk", () => ({
  BrowserUse: vi.fn().mockImplementation(() => ({
    browsers: { create: mocks.create, stop: mocks.stop },
  })),
}));

vi.mock("playwright", () => ({
  chromium: { connectOverCDP: mocks.connectOverCDP },
}));

import { HarnessError, HarnessException } from "@scout/shared";
import { createHarness } from "../factory.js";

interface FakePage {
  goto: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  $$eval: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
  addInitScript: ReturnType<typeof vi.fn>;
}

function defaultExtract(domText = "hello world dom text") {
  return {
    domText,
    title: "Hello",
    description: null,
    ogType: null,
    lang: "en",
    headline: "Hello",
  };
}

function buildPage(opts: { url?: string; bytes?: Buffer } = {}): FakePage {
  return {
    goto: vi.fn().mockResolvedValue({
      ok: () => true,
      status: () => 200,
      headers: () => ({ "content-type": "text/html" }),
    }),
    url: vi.fn().mockReturnValue(opts.url ?? "https://example.test/article"),
    evaluate: vi.fn().mockResolvedValue(undefined),
    $$eval: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(opts.bytes ?? Buffer.from("png-bytes")),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    addInitScript: vi.fn().mockResolvedValue(undefined),
  };
}

function buildBrowser(page: FakePage) {
  const ctx = { newPage: vi.fn().mockResolvedValue(page) };
  return {
    contexts: vi.fn(() => [ctx]),
    newContext: vi.fn().mockResolvedValue(ctx),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function defaultSession(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: "sess-1",
    status: "active",
    cdpUrl: "ws://fake",
    liveUrl: null,
    timeoutAt: now,
    startedAt: now,
    proxyUsedMb: "0",
    proxyCost: "0",
    browserCost: "0",
    ...overrides,
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("BROWSER_USE_API_KEY", "test-key");
  mocks.create.mockReset();
  mocks.stop.mockReset().mockResolvedValue({});
  mocks.connectOverCDP.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("capturePage — happy path (no video)", () => {
  it("returns mode=browser, 3 screenshots, 0 videos, calls stop once, default geo=US", async () => {
    mocks.create.mockResolvedValue(defaultSession());
    const page = buildPage();
    page.evaluate.mockResolvedValueOnce(defaultExtract());
    mocks.connectOverCDP.mockResolvedValue(buildBrowser(page));

    const result = await createHarness().capturePage("https://example.test/article");

    expect(result.capturedBy.mode).toBe("browser");
    expect(result.capturedBy.sdkVersion).toBe("browser-use-sdk@3.6.0");
    expect(result.capturedBy.sessionId).toBe("sess-1");
    expect(result.screenshots).toHaveLength(3);
    expect(result.videoSamples).toHaveLength(0);
    expect(result.domText).toBe("hello world dom text");
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.warnings).toEqual([]);
    expect(result.geo).toBe("US");
    expect(result.requestedUrl).toBe("https://example.test/article");
    expect(result.url).toBe("https://example.test/article");

    expect(mocks.stop).toHaveBeenCalledTimes(1);
    expect(mocks.stop).toHaveBeenCalledWith("sess-1");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({
      proxyCountryCode: "us",
      timeout: 1,
      browserScreenWidth: 1280,
      browserScreenHeight: 800,
      allowResizing: false,
      enableRecording: false,
    });
  });

  it("rejects forceAgentMode with NAVIGATION_FAILED (PRP-C still owns Agent mode)", async () => {
    let thrown: unknown;
    try {
      await createHarness().capturePage("https://example.test/", { forceAgentMode: true });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HarnessException);
    expect((thrown as HarnessException).code).toBe(HarnessError.NAVIGATION_FAILED);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects non-http(s) URLs with NAVIGATION_FAILED before any cloud call", async () => {
    let thrown: unknown;
    try {
      await createHarness().capturePage("file:///etc/passwd");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HarnessException);
    expect((thrown as HarnessException).code).toBe(HarnessError.NAVIGATION_FAILED);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("capturePage — video sampling", () => {
  it("emits poster + first_second_frame for a >=1s <video>", async () => {
    mocks.create.mockResolvedValue(defaultSession());
    const page = buildPage();
    page.evaluate
      .mockResolvedValueOnce(defaultExtract()) // extract
      .mockResolvedValueOnce(undefined) // scroll 1
      .mockResolvedValueOnce(undefined) // scroll 2
      .mockResolvedValueOnce("data:image/jpeg;base64,AAEC"); // first-second frame
    page.$$eval.mockResolvedValueOnce([
      {
        src: "https://cdn.test/v.mp4",
        poster: "https://cdn.test/poster.jpg",
        durationMs: 2500,
      },
    ]);
    mocks.connectOverCDP.mockResolvedValue(buildBrowser(page));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer,
      }),
    );

    const result = await createHarness().capturePage("https://example.test/article");

    expect(result.videoSamples).toHaveLength(2);
    expect(result.videoSamples[0]?.kind).toBe("poster");
    expect(result.videoSamples[0]?.timestampMs).toBe(0);
    expect(result.videoSamples[1]?.kind).toBe("first_second_frame");
    expect(result.videoSamples[1]?.timestampMs).toBe(1000);
    expect(result.warnings).not.toContain("video_first_second_frame_unavailable");

    vi.unstubAllGlobals();
  });

  it("captureVideo:false emits the literal warning 'video_skipped_by_option'", async () => {
    // Reason: the profiler's Q6 cost trip-wire parses this exact string —
    // any rename must be coordinated with that consumer.
    mocks.create.mockResolvedValue(defaultSession());
    const page = buildPage();
    page.evaluate.mockResolvedValueOnce(defaultExtract());
    mocks.connectOverCDP.mockResolvedValue(buildBrowser(page));

    const result = await createHarness().capturePage("https://example.test/article", {
      captureVideo: false,
    });

    expect(result.videoSamples).toEqual([]);
    expect(result.warnings).toEqual(["video_skipped_by_option"]);
    expect(page.$$eval).not.toHaveBeenCalled();
  });
});

describe("capturePage — sampleScrolls matrix", () => {
  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
    [5, 6],
  ])(
    "sampleScrolls=%s → screenshots.length=%s, scrollY strictly increasing",
    async (scrolls, expected) => {
      mocks.create.mockResolvedValue(defaultSession());
      const page = buildPage();
      page.evaluate.mockResolvedValueOnce(defaultExtract()).mockResolvedValue(undefined);
      mocks.connectOverCDP.mockResolvedValue(buildBrowser(page));

      const result = await createHarness().capturePage("https://example.test/article", {
        sampleScrolls: scrolls,
      });

      expect(result.screenshots).toHaveLength(expected);
      for (let i = 1; i < result.screenshots.length; i += 1) {
        const prev = result.screenshots[i - 1]?.scrollY ?? 0;
        const curr = result.screenshots[i]?.scrollY ?? 0;
        expect(curr).toBeGreaterThan(prev);
      }
    },
  );
});

describe("capturePage — contentHash", () => {
  // Pinned constant: sha256("hello world dom text" + "\x00" + "9|9|9").
  // A change here invalidates every cached PageProfile in production.
  const EXPECTED_HASH = "a12b0e19bd9bae9a119916cc2ee38c68c83c8a3cfaf2d0afc21d58881fdf953a";

  it("is deterministic across two identical captures and matches the pinned value", async () => {
    async function runOnce(): Promise<string> {
      mocks.create.mockResolvedValueOnce(defaultSession());
      mocks.stop.mockResolvedValueOnce({});
      const page = buildPage({ bytes: Buffer.from("png-bytes") });
      page.evaluate.mockResolvedValueOnce(defaultExtract()).mockResolvedValue(undefined);
      mocks.connectOverCDP.mockResolvedValueOnce(buildBrowser(page));
      const r = await createHarness().capturePage("https://example.test/article");
      return r.contentHash;
    }
    const h1 = await runOnce();
    const h2 = await runOnce();
    expect(h1).toBe(h2);
    expect(h1).toBe(EXPECTED_HASH);
  });

  // PRP-B2 Task 7 escape hatch: the volatile-DOM strip runs INSIDE
  // page.evaluate. Tests mock evaluate to return canned innerText, so a
  // unit test cannot exercise the strip — it would just verify the mock is
  // consistent with itself. Real verification needs a Playwright
  // integration test against a fixture HTML page; tracked as follow-up.
  it.todo(
    "volatile-noise insensitivity (real strip lives inside page.evaluate; requires integration test)",
  );
});

describe("capturePage — domText truncation", () => {
  function setupExtract(domText: string) {
    mocks.create.mockResolvedValue(defaultSession());
    const page = buildPage();
    page.evaluate
      .mockResolvedValueOnce({ ...defaultExtract(domText) })
      .mockResolvedValue(undefined);
    mocks.connectOverCDP.mockResolvedValue(buildBrowser(page));
    return page;
  }

  it("255 KiB DOM text emits no truncation warning", async () => {
    setupExtract("a".repeat(255 * 1024));
    const result = await createHarness().capturePage("https://example.test/article");
    expect(Buffer.byteLength(result.domText, "utf8")).toBe(255 * 1024);
    expect(result.warnings).not.toContain("dom_text_truncated");
  });

  it("257 KiB DOM text truncates to 256 KiB and emits 'dom_text_truncated'", async () => {
    setupExtract("a".repeat(257 * 1024));
    const result = await createHarness().capturePage("https://example.test/article");
    expect(Buffer.byteLength(result.domText, "utf8")).toBe(256 * 1024);
    expect(result.warnings).toContain("dom_text_truncated");
  });
});

describe("capturePage — URL semantics", () => {
  it("preserves requestedUrl while url reflects the post-redirect location", async () => {
    mocks.create.mockResolvedValue(defaultSession());
    const page = buildPage({ url: "https://example.test/b" });
    page.evaluate.mockResolvedValueOnce(defaultExtract()).mockResolvedValue(undefined);
    mocks.connectOverCDP.mockResolvedValue(buildBrowser(page));

    const result = await createHarness().capturePage("http://example.test/a");

    expect(result.requestedUrl).toBe("http://example.test/a");
    expect(result.url).toBe("https://example.test/b");
  });
});

describe("capturePage — geo proxy", () => {
  it("threads opts.geo:'DE' to SDK as proxyCountryCode:'de' and preserves UPPER on output", async () => {
    mocks.create.mockResolvedValue(defaultSession());
    const page = buildPage();
    page.evaluate.mockResolvedValueOnce(defaultExtract()).mockResolvedValue(undefined);
    mocks.connectOverCDP.mockResolvedValue(buildBrowser(page));

    const result = await createHarness().capturePage("https://example.test/article", {
      geo: "DE",
    });

    expect(result.geo).toBe("DE");
    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({ proxyCountryCode: "de" });
  });
});

describe("capturePage — timeoutMs → SDK timeout (minutes)", () => {
  it.each([
    [100, 1],
    [60_000, 1],
    [120_000, 2],
    [600_000, 10],
    [13_000_000, 217],
  ])("timeoutMs=%s → SDK timeout=%s minutes", async (timeoutMs, expectedMinutes) => {
    mocks.create.mockResolvedValue(defaultSession());
    const page = buildPage();
    page.evaluate.mockResolvedValueOnce(defaultExtract()).mockResolvedValue(undefined);
    mocks.connectOverCDP.mockResolvedValue(buildBrowser(page));

    await createHarness().capturePage("https://example.test/article", { timeoutMs });

    expect(mocks.create.mock.calls[0]?.[0]).toMatchObject({ timeout: expectedMinutes });
  });
});

describe("capturePage — schema-conformance regression", () => {
  it("throws UPSTREAM_DOWN with issue-path-only message when the result fails PageCaptureSchema", async () => {
    // Force the result invalid by making page.url() return a non-URL string;
    // PageCaptureSchema.url is z.string().url() so this fails parsing.
    mocks.create.mockResolvedValue(defaultSession({ cdpUrl: "" }));
    const page = buildPage({ url: "not-a-url" });
    page.evaluate.mockResolvedValueOnce(defaultExtract()).mockResolvedValue(undefined);
    mocks.connectOverCDP.mockResolvedValue(buildBrowser(page));

    let thrown: unknown;
    try {
      await createHarness().capturePage("https://example.test/article");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HarnessException);
    expect((thrown as HarnessException).code).toBe(HarnessError.UPSTREAM_DOWN);
    expect((thrown as HarnessException).message).toMatch(
      /^harness produced invalid PageCapture at path: [\w.]+$/,
    );
    // SECURITY: error message MUST NOT echo any value from the failing field.
    expect((thrown as HarnessException).message).not.toContain("not-a-url");
  });
});
