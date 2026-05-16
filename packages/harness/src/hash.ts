import { createHash } from "node:crypto";

export function computeContentHash(
  canonicalDomText: string,
  screenshotBytes: ReadonlyArray<number>,
): string {
  // Reason: NFC normalize before hashing — without this, "café" (composed é)
  // and "café" (e + combining acute) would produce two PageProfiles for the
  // same content. The \x00 separator prevents (text, bytes) decompositions
  // from colliding with text alone (see hash.test.ts § no-collision case).
  const normalized = canonicalDomText.normalize("NFC");
  const sortedSizes = [...screenshotBytes].sort((a, b) => a - b).join("|");
  return createHash("sha256").update(normalized).update("\x00").update(sortedSizes).digest("hex");
}
