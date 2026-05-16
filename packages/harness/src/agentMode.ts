import { Buffer } from "node:buffer";
import { mkdtemp, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { BrowserUse } from "browser-use-sdk";
import {
  HarnessError,
  HarnessException,
  PageCaptureSchema,
  type CaptureOptions,
  type PageCapture,
  type Screenshot,
  type VideoSample,
} from "@scout/shared";
import type { HarnessConfig } from "./config.js";
import { classifySdkError } from "./errors.js";
import { canonicalDomText, MAX_DOM_TEXT_BYTES, truncateToBytes } from "./extract.js";
import { computeContentHash } from "./hash.js";
import { STORAGE_PLACEHOLDER, rehomeUri, writeScreenshot, writeVideoSample } from "./storage.js";

const SDK_VERSION = "browser-use-sdk@3.6.0";
const AGENT_DEFAULT_TIMEOUT_MS = 60_000;
const VIEWPORT_DEFAULT = { w: 1280, h: 800 } as const;
const SCROLL_STRIDE_PX = 800;
// Vendor's polling interval is enforced server-side; 2s is the SDK default
// and balances cost vs. discovery latency on a finished task. Our outer race
// is the authoritative cap.
const AGENT_POLL_INTERVAL_MS = 2_000;

// SECURITY: only ${url} is interpolated. T3c pins this regex — adding any
// other template variable that takes advertiser-controlled data is a prompt-
// injection vector we cannot mitigate inside the vendor LLM loop. The
// "do not follow off-origin links" clause is the second layer; sessions.create
// keepAlive:false is the third (bounds blast radius to one task).
export const AGENT_TASK_PROMPT = (url: string): string =>
  `Navigate to ${url}. Dismiss any cookie or consent banners using the most permissive option that does NOT require account creation. Do not click any login or signup buttons. Do not follow off-origin links. Scroll the page once to load lazy content. Then stop and return control. Report what you saw using the structured output schema.`;

export const AgentOutputSchema = z.object({
  finalUrl: z.string().url(),
  pageTitle: z.string().nullable(),
  pageHeadline: z.string().nullable(),
  visibleText: z.string().nullable(),
  metaDescription: z.string().nullable(),
  metaOgType: z.string().nullable(),
  metaLang: z.string().nullable(),
  screenshotBase64: z.array(z.string().min(1)).min(1),
  videoPresent: z.boolean(),
  videoPosterBase64: z.string().nullable(),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;

// Hand-authored JSON Schema mirroring AgentOutputSchema. We can't use
// z.toJSONSchema() — that's a zod 4 API, but @scout/shared pins zod 3.
// browser-use-sdk@3.6.0 internally calls zod-4's z.toJSONSchema on the schema
// option, which silently breaks for zod-3 inputs. Sending JSON Schema directly
// via structuredOutput sidesteps the version mismatch and matches the literal
// SDK contract (CreateTaskRequest.structuredOutput: stringified JSON Schema).
export const AGENT_OUTPUT_JSON_SCHEMA = {
  type: "object",
  required: [
    "finalUrl",
    "pageTitle",
    "pageHeadline",
    "visibleText",
    "metaDescription",
    "metaOgType",
    "metaLang",
    "screenshotBase64",
    "videoPresent",
    "videoPosterBase64",
  ],
  properties: {
    finalUrl: { type: "string", format: "uri" },
    pageTitle: { type: ["string", "null"] },
    pageHeadline: { type: ["string", "null"] },
    visibleText: { type: ["string", "null"] },
    metaDescription: { type: ["string", "null"] },
    metaOgType: { type: ["string", "null"] },
    metaLang: { type: ["string", "null"] },
    screenshotBase64: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
    },
    videoPresent: { type: "boolean" },
    videoPosterBase64: { type: ["string", "null"] },
  },
} as const;

export async function captureViaAgent(
  sdk: BrowserUse,
  cfg: HarnessConfig,
  url: string,
  optsIn: CaptureOptions,
): Promise<PageCapture> {
  const timeoutMs = optsIn.timeoutMs ?? AGENT_DEFAULT_TIMEOUT_MS;
  const viewport = optsIn.viewport ?? VIEWPORT_DEFAULT;
  const geoUpper = (optsIn.geo ?? cfg.defaultProxyCountry).toUpperCase();
  const geoLower = geoUpper.toLowerCase();
  const callDir = await mkdtemp(join(tmpdir(), "scout-harness-agent-"));

  let sessionId: string | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  try {
    // SDK reality (verified upstream 2026-05-15, browser-use-sdk@3.6.0):
    // CreateSessionBody is Partial<CreateSessionRequest>; persistMemory and
    // keepAlive default to TRUE server-side, so we MUST pass false explicitly
    // — every session, every time. A regression on either is a cross-
    // advertiser leak.
    const session = await sdk.sessions.create({
      proxyCountryCode: geoLower as never,
      startUrl: url,
      browserScreenWidth: viewport.w,
      browserScreenHeight: viewport.h,
      persistMemory: false,
      keepAlive: false,
      enableRecording: false,
    });
    sessionId = session.id;

    // PRP-C1 R1 resolution: matches D1 literally ("sessions.create →
    // tasks.create"). structuredOutput is the stringified JSON Schema the
    // vendor LLM constrains its output to. We do our own zod safeParse on
    // return for defense-in-depth.
    const taskCreated = await sdk.tasks.create({
      task: AGENT_TASK_PROMPT(url),
      sessionId,
      structuredOutput: JSON.stringify(AGENT_OUTPUT_JSON_SCHEMA),
    });

    // Same Promise.race shape as Browser mode (PRP-B2 D6 Path B). Our setTimeout
    // is the authoritative cap; the SDK's wait() polling is bounded by the same
    // budget but a race protects against the SDK's polling getting stuck.
    const taskView = await new Promise<{ output: string | null }>((resolve, reject) => {
      let settled = false;
      timeoutHandle = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new HarnessException(HarnessError.TIMEOUT, "agent task timeout"));
        }
      }, timeoutMs);
      sdk.tasks.wait(taskCreated.id, { timeout: timeoutMs, interval: AGENT_POLL_INTERVAL_MS }).then(
        (r) => {
          if (!settled) {
            settled = true;
            resolve(r as { output: string | null });
          }
        },
        (err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        },
      );
    });

    let parsedJson: unknown;
    try {
      parsedJson =
        typeof taskView.output === "string" ? JSON.parse(taskView.output) : taskView.output;
    } catch {
      throw new HarnessException(
        HarnessError.UPSTREAM_DOWN,
        "agent output invalid at path: <json>",
      );
    }

    const parsed = AgentOutputSchema.safeParse(parsedJson);
    if (!parsed.success) {
      // SECURITY: path-only message. visibleText may carry PII; echoing the
      // failing value would leak it via error logs.
      const path = parsed.error.issues[0]?.path.join(".") ?? "<unknown>";
      throw new HarnessException(
        HarnessError.UPSTREAM_DOWN,
        `agent output invalid at path: ${path}`,
      );
    }

    return await assembleAgentCapture(callDir, url, geoUpper, sessionId, viewport, parsed.data);
  } catch (e) {
    if (e instanceof HarnessException) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new HarnessException(classifySdkError(e), msg, e);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (sessionId) {
      try {
        // sessions.stop() also stops any running task on the session, per the
        // SDK docs — the orphan-cleanup money-leak surface is the same as
        // Browser mode.
        await sdk.sessions.stop(sessionId);
      } catch {
        // best-effort
      }
    }
  }
}

async function assembleAgentCapture(
  callDir: string,
  requestedUrl: string,
  geoUpper: string,
  sessionId: string,
  viewport: { w: number; h: number },
  out: AgentOutput,
): Promise<PageCapture> {
  const warnings: string[] = [];

  const screenshots: Screenshot[] = [];
  for (let i = 0; i < out.screenshotBase64.length; i += 1) {
    const bytes = Buffer.from(out.screenshotBase64[i] ?? "", "base64");
    screenshots.push(
      await writeScreenshot(callDir, STORAGE_PLACEHOLDER, i, bytes, {
        kind: i === 0 ? "above_fold" : "viewport_sample",
        scrollY: i * SCROLL_STRIDE_PX,
        viewport,
      }),
    );
  }

  const videoSamples: VideoSample[] = [];
  if (out.videoPresent && out.videoPosterBase64) {
    const bytes = Buffer.from(out.videoPosterBase64, "base64");
    videoSamples.push(
      await writeVideoSample(callDir, STORAGE_PLACEHOLDER, 100, bytes, {
        kind: "poster",
        timestampMs: 0,
      }),
    );
    // Agent mode can't surface first-second frames — the vendor LLM doesn't
    // expose them. Downstream verifiers treat this warning as "no temporal
    // evidence" rather than failure.
    warnings.push("video_first_second_frame_unavailable_in_agent_mode");
  }

  const canonical = canonicalDomText(out.visibleText ?? "");
  const truncated = truncateToBytes(canonical, MAX_DOM_TEXT_BYTES);
  if (truncated.length < canonical.length) warnings.push("dom_text_truncated");

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
    videoSamples.map(async (v) => ({
      ...v,
      uri: await rehomeUri(v.uri, STORAGE_PLACEHOLDER, contentHash),
    })),
  );

  const result: PageCapture = {
    url: out.finalUrl,
    requestedUrl,
    contentHash,
    capturedAt: new Date().toISOString(),
    geo: geoUpper,
    domText: truncated,
    headline: out.pageHeadline,
    metadata: {
      title: out.pageTitle,
      description: out.metaDescription,
      ogType: out.metaOgType,
      lang: out.metaLang,
    },
    screenshots: rehomedShots,
    videoSamples: rehomedVideos,
    capturedBy: { mode: "agent", sdkVersion: SDK_VERSION, sessionId },
    warnings,
  };

  const validated = PageCaptureSchema.safeParse(result);
  if (!validated.success) {
    const path = validated.error.issues[0]?.path.join(".") ?? "<unknown>";
    throw new HarnessException(
      HarnessError.UPSTREAM_DOWN,
      `harness produced invalid PageCapture at path: ${path}`,
    );
  }
  return validated.data;
}
