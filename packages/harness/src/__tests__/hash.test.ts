import { describe, expect, it } from "vitest";
import { computeContentHash } from "../hash.js";

// Load-bearing pin: a regression here invalidates every cached PageProfile in
// production (a same-content page produces a NEW hash → fresh capture forced
// → cache stampede). Compute once, pin once.
const PINNED_HELLO_WORLD_100_200 =
  "c16d40435bb7c40a07353e5fbc4f5ee3089631f293f1e537ef25a85babe2b9f4";

describe("computeContentHash", () => {
  it("is deterministic — same inputs → same 64-char hex", () => {
    const a = computeContentHash("hello world", [100, 200]);
    const b = computeContentHash("hello world", [100, 200]);
    expect(a).toBe(b);
    expect(a).toBe(PINNED_HELLO_WORLD_100_200);
  });

  it("matches the PageCaptureSchema contentHash regex /^[a-f0-9]{64}$/", () => {
    const h = computeContentHash("hello world", [100, 200]);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sorts screenshot byte lengths internally — order does not matter", () => {
    const a = computeContentHash("hello world", [100, 200]);
    const b = computeContentHash("hello world", [200, 100]);
    expect(a).toBe(b);
  });

  it("changes when domText changes", () => {
    const a = computeContentHash("hello world", [100, 200]);
    const b = computeContentHash("hello worlds", [100, 200]);
    expect(a).not.toBe(b);
  });

  it("changes when a screenshot byte length changes", () => {
    const a = computeContentHash("hello world", [100, 200]);
    const b = computeContentHash("hello world", [100, 201]);
    expect(a).not.toBe(b);
  });

  it("NFC-normalizes domText — composed and decomposed combine equally", () => {
    // "café" with a precomposed é (U+00E9) versus "cafe" + combining acute (U+0301).
    const composed = "café";
    const decomposed = "café";
    expect(composed).not.toBe(decomposed); // sanity — the two strings differ byte-for-byte
    expect(computeContentHash(composed, [10])).toBe(computeContentHash(decomposed, [10]));
  });

  it("does NOT collide between (domText, bytes) shapes that share string concatenation", () => {
    // Without the \x00 separator, "abc" + [10, 20] would collide with
    // "abc10|20" + []. The separator must prevent this.
    const withBytes = computeContentHash("abc", [10, 20]);
    const noBytes = computeContentHash("abc10|20", []);
    expect(withBytes).not.toBe(noBytes);
  });

  it("accepts an empty screenshot array", () => {
    const h = computeContentHash("hello", []);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});
