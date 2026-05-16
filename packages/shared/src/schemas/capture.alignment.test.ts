import { describe, it } from "vitest";
import type { PageCapture, PageProfile } from "@scout/shared";

/**
 * Type-only alignment check. If either schema renames a load-bearing field
 * (`url`, `contentHash`, `capturedAt`), this fails at type-check time — not at
 * profiler runtime where a silent rename causes cache poisoning.
 *
 * If `pnpm -r exec tsc --noEmit` fails on this file, do NOT relax the test:
 * the fix is to align the field names back.
 */
type ProfileFieldsFromCapture = {
  url: PageCapture["url"];
  contentHash: PageCapture["contentHash"];
  capturedAt: PageCapture["capturedAt"];
};

const _alignment: Pick<PageProfile, "url" | "contentHash" | "capturedAt"> =
  {} as ProfileFieldsFromCapture;
void _alignment;

describe("PageCapture ↔ PageProfile field alignment", () => {
  it("compiles iff url/contentHash/capturedAt agree on type between the two schemas", () => {
    // The real assertion is the module-level type expression above; this
    // it-block keeps vitest from flagging the file as empty.
  });
});
