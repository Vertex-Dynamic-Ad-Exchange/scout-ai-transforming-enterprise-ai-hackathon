import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, rename, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STORAGE_PLACEHOLDER, rehomeUri, writeScreenshot, writeVideoSample } from "../storage.js";

const STUB_HASH = "f".repeat(64);

describe("storage.ts", () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "scout-evidence-test-"));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  describe("writeScreenshot", () => {
    it("writes the buffer to {baseDir}/{contentHash}/{idx}.png and returns a Screenshot", async () => {
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic
      const result = await writeScreenshot(baseDir, STUB_HASH, 0, bytes, {
        kind: "above_fold",
        scrollY: 0,
        viewport: { w: 1280, h: 800 },
      });

      const expectedPath = join(baseDir, STUB_HASH, "0.png");
      expect(result.uri).toBe(`file://${expectedPath}`);
      expect(result.bytes).toBe(bytes.length);
      expect(result.kind).toBe("above_fold");
      expect(result.scrollY).toBe(0);
      expect(result.viewport).toEqual({ w: 1280, h: 800 });

      const fileBytes = await readFile(expectedPath);
      expect(fileBytes.equals(bytes)).toBe(true);
    });

    it("overwrites idempotently when called twice with the same args", async () => {
      const first = Buffer.from("first");
      const second = Buffer.from("second-payload");
      await writeScreenshot(baseDir, STUB_HASH, 0, first, {
        kind: "above_fold",
        scrollY: 0,
        viewport: { w: 1280, h: 800 },
      });
      const result = await writeScreenshot(baseDir, STUB_HASH, 0, second, {
        kind: "above_fold",
        scrollY: 0,
        viewport: { w: 1280, h: 800 },
      });

      const onDisk = await readFile(join(baseDir, STUB_HASH, "0.png"));
      expect(onDisk.equals(second)).toBe(true);
      expect(result.bytes).toBe(second.length);
    });

    it("accepts a zero-byte buffer", async () => {
      const empty = Buffer.alloc(0);
      const result = await writeScreenshot(baseDir, STUB_HASH, 3, empty, {
        kind: "viewport_sample",
        scrollY: 800,
        viewport: { w: 1280, h: 800 },
      });
      expect(result.bytes).toBe(0);
      const onDisk = await stat(join(baseDir, STUB_HASH, "3.png"));
      expect(onDisk.size).toBe(0);
    });
  });

  describe("writeVideoSample", () => {
    it("writes .jpg for kind='poster'", async () => {
      const bytes = Buffer.from([0xff, 0xd8, 0xff]); // JPEG SOI
      const result = await writeVideoSample(baseDir, STUB_HASH, 0, bytes, {
        kind: "poster",
        timestampMs: 0,
      });
      expect(result.uri.endsWith("/0.jpg")).toBe(true);
      expect(result.kind).toBe("poster");
      expect(result.timestampMs).toBe(0);
      const fileBytes = await readFile(join(baseDir, STUB_HASH, "0.jpg"));
      expect(fileBytes.equals(bytes)).toBe(true);
    });

    it("writes .bin for kind='first_second_frame'", async () => {
      const bytes = Buffer.from("h264-frame-bytes");
      const result = await writeVideoSample(baseDir, STUB_HASH, 1, bytes, {
        kind: "first_second_frame",
        timestampMs: 1000,
      });
      expect(result.uri.endsWith("/1.bin")).toBe(true);
      expect(result.bytes).toBe(bytes.length);
    });
  });

  describe("rehomeUri", () => {
    it("rewrites a placeholder URI to the real contentHash directory", async () => {
      const bytes = Buffer.from("placeholder-asset");
      const initial = await writeScreenshot(baseDir, STORAGE_PLACEHOLDER, 0, bytes, {
        kind: "above_fold",
        scrollY: 0,
        viewport: { w: 1280, h: 800 },
      });

      // Caller is responsible for renaming the on-disk directory.
      await rename(join(baseDir, STORAGE_PLACEHOLDER), join(baseDir, STUB_HASH));

      const next = await rehomeUri(initial.uri, STORAGE_PLACEHOLDER, STUB_HASH);
      expect(next).toBe(`file://${join(baseDir, STUB_HASH, "0.png")}`);

      const onDisk = await readFile(join(baseDir, STUB_HASH, "0.png"));
      expect(onDisk.equals(bytes)).toBe(true);
    });
  });
});
