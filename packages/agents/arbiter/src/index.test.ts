import { describe, expect, it } from "vitest";
import { ArbiterDecisionSchema, type ArbiterContext, type PageCapture } from "@scout/shared";
import { createArbiter } from "./index.js";

const STUB_CAPTURE = {
  url: "https://example.test/article",
  requestedUrl: "https://example.test/article",
  contentHash: "a".repeat(64),
  capturedAt: "2026-05-16T00:00:00.000Z",
  geo: "US",
  domText: "hello",
  headline: null,
  metadata: { title: null, description: null, ogType: null, lang: null },
  screenshots: [
    {
      uri: "file:///tmp/x/0.png",
      kind: "above_fold" as const,
      scrollY: 0,
      viewport: { w: 1280, h: 800 },
      bytes: 1,
    },
  ],
  videoSamples: [],
  capturedBy: { mode: "browser" as const, sdkVersion: "stub", sessionId: "s1" },
  warnings: [],
} satisfies PageCapture;

const ctx = (): ArbiterContext => ({
  advertiserId: "adv-1",
  policyId: "pol-1",
  humanReviewThreshold: 0.7,
  abortSignal: new AbortController().signal,
});

describe("createArbiter (stub)", () => {
  it("returns an Arbiter whose combine() yields a valid ArbiterDecision", async () => {
    const arb = createArbiter();
    const decision = await arb.combine([], STUB_CAPTURE, ctx());
    expect(() => ArbiterDecisionSchema.parse(decision)).not.toThrow();
    expect(["ALLOW", "DENY", "HUMAN_REVIEW"]).toContain(decision.decision);
  });

  it("returns confidence in [0,1]", async () => {
    const arb = createArbiter();
    const decision = await arb.combine([], STUB_CAPTURE, ctx());
    expect(decision.confidence).toBeGreaterThanOrEqual(0);
    expect(decision.confidence).toBeLessThanOrEqual(1);
  });

  it("accepts an optional deps.llm: unknown without coupling to LlmClient", () => {
    const arb = createArbiter({ llm: { stub: true } });
    expect(typeof arb.combine).toBe("function");
  });
});
