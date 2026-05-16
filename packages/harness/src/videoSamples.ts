import type { Page } from "playwright";
import type { VideoSample } from "@scout/shared";
import { STORAGE_PLACEHOLDER, writeVideoSample } from "./storage.js";

interface VideoMeta {
  readonly src: string;
  readonly poster: string;
  readonly durationMs: number;
}

export interface VideoCaptureResult {
  readonly samples: VideoSample[];
  readonly warnings: string[];
}

// D2 (PRP-B2): poster + first-second frame per <video>. Frame-extraction is
// the risky path; if it throws (cross-origin, codec, decoder), we degrade to
// poster-only and emit `video_first_second_frame_unavailable`. Downstream
// verifiers treat that warning as "no temporal evidence" rather than failure.
export async function captureVideoSamples(
  page: Page,
  callDir: string,
): Promise<VideoCaptureResult> {
  const videos = (await page.$$eval("video", (els: Element[]) =>
    els.map((el): VideoMeta => {
      const v = el as HTMLVideoElement;
      return {
        src: v.currentSrc || v.src || "",
        poster: v.poster || "",
        durationMs: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0,
      };
    }),
  )) as VideoMeta[];

  const samples: VideoSample[] = [];
  const warnings: string[] = [];
  // Reason: start at 100 so video filenames never collide with screenshot
  // indices (0..N) within the same placeholder directory.
  let idx = 100;
  for (const v of videos) {
    if (v.poster) {
      const bytes = await downloadBytes(v.poster);
      if (bytes) {
        samples.push(
          await writeVideoSample(callDir, STORAGE_PLACEHOLDER, idx++, bytes, {
            kind: "poster",
            timestampMs: 0,
          }),
        );
      }
    }
    if (!v.src || v.durationMs < 1000) continue;
    const frameBytes = await captureFirstSecondFrame(page, v.src);
    if (frameBytes) {
      samples.push(
        await writeVideoSample(callDir, STORAGE_PLACEHOLDER, idx++, frameBytes, {
          kind: "first_second_frame",
          timestampMs: 1000,
        }),
      );
    } else {
      warnings.push("video_first_second_frame_unavailable");
    }
  }
  return { samples, warnings };
}

async function captureFirstSecondFrame(page: Page, src: string): Promise<Buffer | null> {
  try {
    const dataUrl = (await page.evaluate(
      async ({ src: vsrc, timestampMs }: { src: string; timestampMs: number }) =>
        new Promise<string>((resolve, reject) => {
          const video = document.createElement("video");
          video.crossOrigin = "anonymous";
          video.src = vsrc;
          video.muted = true;
          video.preload = "auto";
          const tm = setTimeout(() => reject(new Error("video timeout")), 8000);
          video.onloadeddata = () => {
            video.currentTime = timestampMs / 1000;
          };
          video.onseeked = () => {
            clearTimeout(tm);
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth || 1;
            canvas.height = video.videoHeight || 1;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("no 2d context"));
              return;
            }
            ctx.drawImage(video, 0, 0);
            resolve(canvas.toDataURL("image/jpeg", 0.85));
          };
          video.onerror = () => {
            clearTimeout(tm);
            reject(new Error("video error"));
          };
        }),
      { src, timestampMs: 1000 },
    )) as string;
    const b64 = dataUrl.split(",")[1] ?? "";
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

async function downloadBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}
