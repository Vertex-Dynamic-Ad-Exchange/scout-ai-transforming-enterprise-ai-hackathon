import { describe, expect, it } from "vitest";
import { MAX_DOM_TEXT_BYTES, canonicalDomText, truncateToBytes } from "../extract.js";

describe("MAX_DOM_TEXT_BYTES", () => {
  it("is exactly 256 KiB", () => {
    expect(MAX_DOM_TEXT_BYTES).toBe(256 * 1024);
  });
});

describe("canonicalDomText", () => {
  it("collapses whitespace runs to a single space and trims", () => {
    expect(canonicalDomText("  Hello\n\n  World  ")).toBe("Hello World");
  });

  it("NFC-normalizes a decomposed-accent input to its composed form", () => {
    // "café" decomposed: "café" → after NFC: "café" (precomposed é).
    const decomposed = "café";
    const result = canonicalDomText(decomposed);
    expect(result).toBe("café"); // precomposed (length 4 codepoints), not 5
    expect(result.normalize("NFC")).toBe(result);
  });

  it("returns an empty string for empty input (no throw)", () => {
    expect(canonicalDomText("")).toBe("");
  });

  it("handles a whitespace-only input by returning ''", () => {
    expect(canonicalDomText("   \n\t  ")).toBe("");
  });
});

describe("truncateToBytes", () => {
  it("returns the string unchanged when under the cap", () => {
    expect(truncateToBytes("hello", 100)).toBe("hello");
  });

  it("returns the string unchanged when byteLength === cap", () => {
    const exact = "a".repeat(MAX_DOM_TEXT_BYTES); // ASCII: 1 byte per char
    expect(Buffer.byteLength(exact, "utf8")).toBe(MAX_DOM_TEXT_BYTES);
    expect(truncateToBytes(exact, MAX_DOM_TEXT_BYTES)).toBe(exact);
  });

  it("truncates ASCII strings to exactly cap bytes when over", () => {
    const over = "a".repeat(MAX_DOM_TEXT_BYTES + 100);
    const result = truncateToBytes(over, MAX_DOM_TEXT_BYTES);
    expect(Buffer.byteLength(result, "utf8")).toBe(MAX_DOM_TEXT_BYTES);
  });

  it("never truncates mid-multibyte-character (UTF-8 safety)", () => {
    // "é" is 2 bytes in UTF-8 (U+00E9 → 0xC3 0xA9). A long run plus 1 extra
    // ASCII char to push the cap boundary off any clean 2-byte alignment.
    const cap = 1001;
    const multibyte = "é".repeat(1000) + "x"; // 2001 bytes
    expect(Buffer.byteLength(multibyte, "utf8")).toBe(2001);

    const result = truncateToBytes(multibyte, cap);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(cap);

    // Round-trip through Buffer must not throw or replace bytes (no U+FFFD).
    const roundTrip = Buffer.from(result, "utf8").toString("utf8");
    expect(roundTrip).toBe(result);
    expect(result).not.toMatch(/�/);
  });

  it("returns the empty string when cap is 0", () => {
    expect(truncateToBytes("hello", 0)).toBe("");
  });
});
