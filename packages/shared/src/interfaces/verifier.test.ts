import { describe, expect, it } from "vitest";
import type { AgentVerdict, PageCapture, Verifier, VerifierContext } from "@scout/shared";

describe("Verifier interface — compile-time assignability", () => {
  it("satisfies a minimal literal impl", () => {
    const impl = {
      kind: "text" as const,
      async verify(_c: PageCapture, _ctx: VerifierContext): Promise<AgentVerdict> {
        return {
          verifier: "text",
          decision: "ALLOW",
          categories: [],
          detectedEntities: [],
          evidenceRefs: [],
          modelLatencyMs: 0,
          lobstertrapTraceId: null,
        };
      },
    } satisfies Verifier;
    expect(impl.kind).toBe("text");
  });

  it("accepts an image-kind verifier impl", () => {
    const impl = {
      kind: "image" as const,
      async verify(_c: PageCapture, _ctx: VerifierContext): Promise<AgentVerdict> {
        return {
          verifier: "image",
          decision: "ALLOW",
          categories: [],
          detectedEntities: [],
          evidenceRefs: [],
          modelLatencyMs: 0,
          lobstertrapTraceId: null,
        };
      },
    } satisfies Verifier;
    expect(impl.kind).toBe("image");
  });

  it("accepts a VerifierContext literal", () => {
    const controller = new AbortController();
    const ctx: VerifierContext = {
      advertiserId: "adv-1",
      policyId: "pol-1",
      degradationHint: "none",
      abortSignal: controller.signal,
    };
    expect(ctx.advertiserId).toBe("adv-1");
    expect(ctx.abortSignal.aborted).toBe(false);
  });
});
