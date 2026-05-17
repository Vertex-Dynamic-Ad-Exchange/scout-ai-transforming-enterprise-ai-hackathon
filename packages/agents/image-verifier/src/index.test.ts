import { describe, expect, it } from "vitest";
import { AgentVerdictSchema, type PageCapture, type VerifierContext } from "@scout/shared";
import { createImageVerifier } from "./index.js";

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

const ctx = (): VerifierContext => ({
  advertiserId: "adv-1",
  policyId: "pol-1",
  degradationHint: "none",
  abortSignal: new AbortController().signal,
});

describe("createImageVerifier (stub)", () => {
  it("returns a Verifier with kind 'image'", () => {
    const v = createImageVerifier();
    expect(v.kind).toBe("image");
  });

  it("verify() returns an AgentVerdict that parses against AgentVerdictSchema", async () => {
    const v = createImageVerifier();
    const verdict = await v.verify(STUB_CAPTURE, ctx());
    expect(() => AgentVerdictSchema.parse(verdict)).not.toThrow();
    expect(verdict.verifier).toBe("image");
    expect(["ALLOW", "DENY", "HUMAN_REVIEW"]).toContain(verdict.decision);
  });

  it("accepts an optional deps.llm: unknown without coupling to LlmClient", () => {
    const v = createImageVerifier({ llm: { stub: true } });
    expect(v.kind).toBe("image");
  });
});
