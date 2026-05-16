import { mkdtemp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserUse } from "browser-use-sdk";
import { chromium, type Browser } from "playwright";
import {
  HarnessError,
  HarnessException,
  PageCaptureSchema,
  type CaptureOptions,
  type PageCapture,
} from "@scout/shared";
import type { HarnessConfig } from "./config.js";
import { classifySdkError } from "./errors.js";
import { detectConsentWall } from "./consentWall.js";
import { canonicalDomText, MAX_DOM_TEXT_BYTES, truncateToBytes } from "./extract.js";
import { computeContentHash } from "./hash.js";
import { extractFromPage } from "./domExtract.js";
import { captureScreenshots } from "./screenshots.js";
import { captureVideoSamples } from "./videoSamples.js";
import { STORAGE_PLACEHOLDER, rehomeUri } from "./storage.js";

const SDK_VERSION = "browser-use-sdk@3.6.0";
const BROWSER_DEFAULT_TIMEOUT_MS = 15_000;
const VIEWPORT_DEFAULT = { w: 1280, h: 800 } as const;
const SAMPLE_SCROLLS_DEFAULT = 2;

function timeoutToMinutes(timeoutMs: number): number {
  // D3: SDK timeout unit is MINUTES (server caps 240). Min-1 clamp — the API
  // rejects sub-minute sessions, so a 100ms request still book-ends at 1.
  return Math.max(1, Math.ceil(timeoutMs / 60_000));
}

export async function capturePage(
  sdk: BrowserUse,
  cfg: HarnessConfig,
  url: string,
  opts: CaptureOptions,
): Promise<PageCapture> {
  // PRP-C2: options are parsed once in capture.ts (single entry point). This
  // function trusts the shape — re-parsing would just duplicate work. If a
  // future caller bypasses capture.ts the type signature still pins the
  // contract; runtime garbage gets caught at the orchestrator's .strict() parse.
  //
  // forceAgentMode routing also lives in capture.ts now. If the flag still
  // arrives here it's a routing regression upstream; the option is metadata-
  // only at this layer.

  // URL scheme guard. file://, data:, chrome-extension://, javascript:
  // must never reach the cloud session.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HarnessException(HarnessError.NAVIGATION_FAILED, "invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HarnessException(HarnessError.NAVIGATION_FAILED, "unsupported URL scheme");
  }

  const timeoutMs = opts.timeoutMs ?? BROWSER_DEFAULT_TIMEOUT_MS;
  const viewport = opts.viewport ?? VIEWPORT_DEFAULT;
  const sampleScrolls = opts.sampleScrolls ?? SAMPLE_SCROLLS_DEFAULT;
  const captureVideo = opts.captureVideo ?? true;
  const geoUpper = (opts.geo ?? cfg.defaultProxyCountry).toUpperCase();
  const geoLower = geoUpper.toLowerCase();

  let sessionId: string | undefined;
  let browser: Browser | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const callDir = await mkdtemp(join(tmpdir(), "scout-harness-"));

  try {
    // 4–5. D6 Path B — the SDK has no AbortSignal in browsers.create(), so we
    //      bound it with a hard timeout. A single `settled` flag arbitrates
    //      between the timeout and the SDK resolution: only one wins.
    //      If timeout wins and the SDK eventually resolves, we cleanup the
    //      orphaned cloud session; if the SDK eventually rejects, we swallow
    //      so the test's unhandledRejection spy stays at zero.
    type CreateResult = Awaited<ReturnType<typeof sdk.browsers.create>>;
    const session: CreateResult = await new Promise<CreateResult>((resolve, reject) => {
      let settled = false;
      timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new HarnessException(HarnessError.TIMEOUT, "browser create timeout"));
        }
      }, timeoutMs);
      sdk.browsers
        .create({
          proxyCountryCode: geoLower as never,
          timeout: timeoutToMinutes(timeoutMs),
          browserScreenWidth: viewport.w,
          browserScreenHeight: viewport.h,
          allowResizing: false,
          enableRecording: false,
        })
        .then(
          (s) => {
            if (!settled) {
              settled = true;
              resolve(s);
            } else if (s?.id) {
              // Late-resolve after we already threw TIMEOUT — orphan-clean.
              sdk.browsers.stop(s.id).catch(() => undefined);
            }
          },
          (err) => {
            if (!settled) {
              settled = true;
              reject(err);
            }
            // else: swallow late rejection
          },
        );
    });
    sessionId = session.id;

    // 6. Connect Playwright over the SDK-provisioned CDP URL.
    browser = await chromium.connectOverCDP(session.cdpUrl ?? "");
    const ctx = browser.contexts()[0] ?? (await browser.newContext());
    const page = await ctx.newPage();

    // Reason: tsx/esbuild wraps inner function declarations with a __name()
    // "keep names" helper. Playwright serializes our page.evaluate function
    // via .toString() and ships the source to the browser, where __name
    // isn't defined → ReferenceError on every evaluate. Identity shim is
    // harmless in production builds where __name was never injected.
    await page.addInitScript(() => {
      (globalThis as unknown as { __name?: <T>(fn: T) => T }).__name =
        (globalThis as unknown as { __name?: <T>(fn: T) => T }).__name ?? ((fn) => fn);
    });

    // 7. Navigate. `load` over `networkidle` — ad-supported pages never
    //    reach networkidle (the trackers are the point), and brand-safety
    //    verification only needs the document + initial subresources.
    const resp = await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    if (!resp) throw new HarnessException(HarnessError.NAVIGATION_FAILED, "no response");
    if (!resp.ok()) {
      throw new HarnessException(HarnessError.BLOCKED, `HTTP ${resp.status()}`);
    }

    // 8. Content-Type guard. application/pdf and other non-HTML payloads
    //    fall outside the brand-safety surface — verifiers expect DOM.
    const ct = (resp.headers()["content-type"] ?? "").toLowerCase();
    if (ct.startsWith("application/pdf")) {
      throw new HarnessException(HarnessError.NAVIGATION_FAILED, "unsupported content-type");
    }

    // 9. PRP-C1 D4: consent-wall heuristic. False positives cost an extra
    //    Agent round-trip (PRP-C2); false negatives surface as low-quality
    //    Browser captures. Exit BEFORE paying for extract + screenshots so
    //    the two-pass orchestrator can decide quickly.
    if (await detectConsentWall(page)) {
      throw new HarnessException(HarnessError.CONSENT_WALL_UNRESOLVED, "consent wall present");
    }

    // 10–11. DOM extraction (text + metadata + headline) in one round-trip.
    const extracted = await extractFromPage(page);
    const warnings: string[] = [];
    const canonical = canonicalDomText(extracted.domText);
    const truncated = truncateToBytes(canonical, MAX_DOM_TEXT_BYTES);
    if (truncated.length < canonical.length) warnings.push("dom_text_truncated");

    // 12. Screenshots (above-fold + scroll samples).
    const screenshots = await captureScreenshots(page, callDir, viewport, sampleScrolls);

    // 13. Video samples. captureVideo:false emits the literal warning string
    //     the profiler's Q6 cost trip-wire parses — DO NOT alter without
    //     coordinating with profiler.
    const videoResult = captureVideo
      ? await captureVideoSamples(page, callDir)
      : { samples: [], warnings: ["video_skipped_by_option"] };
    warnings.push(...videoResult.warnings);

    // 14. contentHash includes screenshot byte lengths — two captures of the
    //     same article with different ad creatives diverge as intended.
    const contentHash = computeContentHash(
      truncated,
      screenshots.map((s) => s.bytes),
    );
    await rename(join(callDir, STORAGE_PLACEHOLDER), join(callDir, contentHash));
    const rehomedShots = await Promise.all(
      screenshots.map(async (s) => ({
        ...s,
        uri: await rehomeUri(s.uri, STORAGE_PLACEHOLDER, contentHash),
      })),
    );
    const rehomedVideos = await Promise.all(
      videoResult.samples.map(async (v) => ({
        ...v,
        uri: await rehomeUri(v.uri, STORAGE_PLACEHOLDER, contentHash),
      })),
    );

    const result: PageCapture = {
      url: page.url(),
      requestedUrl: url,
      contentHash,
      capturedAt: new Date().toISOString(),
      geo: geoUpper,
      domText: truncated,
      headline: extracted.headline,
      metadata: {
        title: extracted.title,
        description: extracted.description,
        ogType: extracted.ogType,
        lang: extracted.lang,
      },
      screenshots: rehomedShots,
      videoSamples: rehomedVideos,
      capturedBy: { mode: "browser", sdkVersion: SDK_VERSION, sessionId: session.id },
      warnings,
    };

    // 15. SECURITY: path-only error message. domText can hold up to 256 KiB
    //     of arbitrary page content — never echo the offending value, even
    //     in the dev console.
    const validated = PageCaptureSchema.safeParse(result);
    if (!validated.success) {
      const path = validated.error.issues[0]?.path.join(".") ?? "<unknown>";
      throw new HarnessException(
        HarnessError.UPSTREAM_DOWN,
        `harness produced invalid PageCapture at path: ${path}`,
      );
    }
    return validated.data;
  } catch (e) {
    if (e instanceof HarnessException) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new HarnessException(classifySdkError(e), msg, e);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    try {
      await browser?.close();
    } catch {
      // best-effort: cloud session may already be torn down
    }
    if (sessionId) {
      try {
        await sdk.browsers.stop(sessionId);
      } catch {
        // best-effort
      }
    }
  }
}
