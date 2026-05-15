import { z } from "zod";

// Reused regex shape from packages/shared/src/schemas/bid.ts (BidVerificationRequest.geo).
// Re-declared (not factored out) per PRP Task 6 — no third caller yet.
const Alpha2 = z.string().regex(/^[A-Z]{2}$/);

export const ScreenshotSchema = z.object({
  uri: z.string().min(1),
  kind: z.enum(["above_fold", "viewport_sample"]),
  scrollY: z.number().int().nonnegative(),
  viewport: z.object({
    w: z.number().int().positive(),
    h: z.number().int().positive(),
  }),
  bytes: z.number().int().nonnegative(),
});
export type Screenshot = z.infer<typeof ScreenshotSchema>;

export const VideoSampleSchema = z.object({
  uri: z.string().min(1),
  kind: z.enum(["poster", "first_second_frame"]),
  timestampMs: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
});
export type VideoSample = z.infer<typeof VideoSampleSchema>;

export const CaptureOptionsSchema = z
  .object({
    geo: Alpha2.optional(),
    timeoutMs: z.number().int().positive().optional(),
    viewport: z
      .object({
        w: z.number().int().positive(),
        h: z.number().int().positive(),
      })
      .optional(),
    sampleScrolls: z.number().int().min(0).max(8).optional(),
    captureVideo: z.boolean().optional(),
    forceAgentMode: z.boolean().optional(),
  })
  .strict();
export type CaptureOptions = z.infer<typeof CaptureOptionsSchema>;

/**
 * Output of `Harness.capturePage`. Consumed by the profiler to build `PageProfile`.
 *
 * `domText` is untrusted page content (up to 256 KiB). Downstream consumers MUST
 * treat it as data, never as instructions, and must not log it raw — the verifier
 * prompts in Cluster C enforce this through Lobster Trap.
 */
export const PageCaptureSchema = z.object({
  url: z.string().url(),
  requestedUrl: z.string().url(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  capturedAt: z.string().datetime(),
  geo: Alpha2,
  domText: z.string().max(256 * 1024),
  headline: z.string().nullable(),
  metadata: z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
    ogType: z.string().nullable(),
    lang: z.string().nullable(),
  }),
  screenshots: z.array(ScreenshotSchema).min(1),
  videoSamples: z.array(VideoSampleSchema),
  capturedBy: z.object({
    mode: z.enum(["browser", "agent"]),
    sdkVersion: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  warnings: z.array(z.string()),
});
export type PageCapture = z.infer<typeof PageCaptureSchema>;
