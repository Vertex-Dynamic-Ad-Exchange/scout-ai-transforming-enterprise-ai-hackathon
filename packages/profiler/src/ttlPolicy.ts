// PRP-D Task 2: TTL heuristic (feature lines 93-97). Pure function over the
// `PageCapture.metadata.ogType` + URL host/pathname. Constants live in
// `config.ts` (PRP-D D10 — single env-var access site).

import type { PageCapture } from "@scout/shared";
import { profilerConfig } from "./config.js";

// PRP-D D12: host + pathname. UGC names are anchored to the host root
// (optionally preceded by a single subdomain segment), so `example.com/reddit`
// does NOT match. `youtube.com/shorts` is path-aware via an explicit suffix.
// The PRP-text pseudocode uses an unanchored regex; the locked behavior
// (D12 negative case) requires the anchor — codify it here, not the literal
// pseudocode.
const UGC_HOST_PATH =
  /^(?:[^/]*\.)?(?:reddit\.com|twitter\.com|x\.com|tiktok\.com|youtube\.com\/shorts)/i;

/**
 * Returns a TTL in seconds, matching `PageProfileSchema.ttl`'s convention
 * (feature line 151: a unit bug here lets profiles live 1000× too long).
 *
 * Decision order (first match wins):
 *  1. `metadata.ogType` ∈ {`article`, `news`} or starts with `video.` → news TTL.
 *  2. `URL.host + URL.pathname` matches the UGC pattern → UGC TTL.
 *  3. Default.
 *
 * Invalid URLs (`new URL` throws) → default TTL. This is the same lenient
 * fallback the PRP-D pseudocode pins (PRP § Target contracts → `ttlPolicy.ts`).
 */
export function computeTtl(capture: PageCapture): number {
  const cfg = profilerConfig();
  const og = capture.metadata.ogType;
  if (og === "article" || og === "news" || (og !== null && og.startsWith("video."))) {
    return cfg.ttlNewsSeconds;
  }
  let url: URL;
  try {
    url = new URL(capture.url);
  } catch {
    return cfg.ttlDefaultSeconds;
  }
  if (UGC_HOST_PATH.test(url.host + url.pathname)) return cfg.ttlUgcSeconds;
  return cfg.ttlDefaultSeconds;
}
