import { describe, expect, it } from "vitest";
import { rewriteEvidenceUri } from "../commit.js";

// PRP-E D1/D2: pure tenant-scoping helper for evidence URIs. Tested in
// isolation because cross-advertiser disjointness is the regression guard for
// a cross-tenant disclosure bug (feature line 247).

describe("rewriteEvidenceUri — happy", () => {
  it("rewrites the canonical harness shape, preserving extension", () => {
    const out = rewriteEvidenceUri(
      "file:///tmp/scout-evidence/abc123/0.png",
      "advertiser-A",
      "abc123",
    );
    expect(out).toBe("evidence/advertiser-A/abc123/0.png");
  });

  it("preserves .jpg / .webp / no-extension tails", () => {
    expect(rewriteEvidenceUri("file:///tmp/scout-evidence/h/0.jpg", "adv-X", "h")).toBe(
      "evidence/adv-X/h/0.jpg",
    );
    expect(rewriteEvidenceUri("file:///tmp/scout-evidence/h/0.webp", "adv-X", "h")).toBe(
      "evidence/adv-X/h/0.webp",
    );
    expect(rewriteEvidenceUri("file:///tmp/scout-evidence/h/poster", "adv-X", "h")).toBe(
      "evidence/adv-X/h/poster",
    );
  });
});

describe("rewriteEvidenceUri — cross-advertiser disjointness (PRP-E D1)", () => {
  // Feature line 247: a regression here is a cross-tenant disclosure bug.
  it("same contentHash + different advertiserId → disjoint URIs", () => {
    const hash = "abc123";
    const a = rewriteEvidenceUri("file:///tmp/scout-evidence/abc123/0.png", "advertiser-A", hash);
    const b = rewriteEvidenceUri("file:///tmp/scout-evidence/abc123/0.png", "advertiser-B", hash);
    expect(a).not.toBe(b);
    expect(a.startsWith("evidence/advertiser-A/")).toBe(true);
    expect(b.startsWith("evidence/advertiser-B/")).toBe(true);
  });
});

describe("rewriteEvidenceUri — idempotency (D2)", () => {
  it("passes through unchanged when already namespaced under the same advertiser", () => {
    const in_ = "evidence/advertiser-A/abc123/0.png";
    expect(rewriteEvidenceUri(in_, "advertiser-A", "abc123")).toBe(in_);
  });
});

describe("rewriteEvidenceUri — failure modes", () => {
  it("throws on cross-advertiser namespace conflict (D2)", () => {
    expect(() =>
      rewriteEvidenceUri("evidence/advertiser-B/abc/0.png", "advertiser-A", "abc"),
    ).toThrow(/namespace conflict/);
  });

  it("rejects empty advertiserId", () => {
    expect(() => rewriteEvidenceUri("file:///tmp/scout-evidence/abc/0.png", "", "abc")).toThrow();
  });
});
