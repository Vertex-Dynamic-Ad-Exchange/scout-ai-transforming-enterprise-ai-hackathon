import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Screenshot, VideoSample } from "@scout/shared";

// SECURITY: callers inject baseDir. Never interpolate untrusted input into the
// path; storage is a sink for harness-emitted bytes, not a user-controlled
// file write. PRP-B1 § Storage Guardrails.

const PLACEHOLDER_DIR = "_placeholder_";
export const STORAGE_PLACEHOLDER = PLACEHOLDER_DIR;

export async function writeScreenshot(
  baseDir: string,
  contentHashOrPlaceholder: string,
  idx: number,
  bytes: Buffer,
  meta: Pick<Screenshot, "kind" | "scrollY" | "viewport">,
): Promise<Screenshot> {
  const dir = join(baseDir, contentHashOrPlaceholder);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${idx}.png`);
  await writeFile(path, bytes);
  return {
    uri: `file://${path}`,
    bytes: bytes.length,
    kind: meta.kind,
    scrollY: meta.scrollY,
    viewport: meta.viewport,
  };
}

export async function writeVideoSample(
  baseDir: string,
  contentHashOrPlaceholder: string,
  idx: number,
  bytes: Buffer,
  meta: Pick<VideoSample, "kind" | "timestampMs">,
): Promise<VideoSample> {
  const dir = join(baseDir, contentHashOrPlaceholder);
  await mkdir(dir, { recursive: true });
  // Reason: poster frames come from <video poster=...> or canvas.toDataURL
  // — always JPEG. First-second frames may be h264 NALU bytes when the
  // browser-use Cloud surfaces them raw; flag as .bin so verifiers know to
  // probe with ffprobe rather than assume JPEG.
  const ext = meta.kind === "poster" ? "jpg" : "bin";
  const path = join(dir, `${idx}.${ext}`);
  await writeFile(path, bytes);
  return {
    uri: `file://${path}`,
    bytes: bytes.length,
    kind: meta.kind,
    timestampMs: meta.timestampMs,
  };
}

export async function rehomeUri(
  placeholderUri: string,
  placeholderDir: string,
  contentHash: string,
): Promise<string> {
  // Reason: capturePage cannot know contentHash until *after* all assets are
  // captured (hash depends on screenshot byte lengths). So we write under a
  // placeholder dir, compute the hash, rename the dir on disk, then call this
  // to rewrite the cached URI strings inside the returned Screenshot[] /
  // VideoSample[]. The directory rename is the caller's responsibility — this
  // function is pure string substitution so it stays unit-testable without a
  // filesystem race.
  return placeholderUri.replace(`/${placeholderDir}/`, `/${contentHash}/`);
}
