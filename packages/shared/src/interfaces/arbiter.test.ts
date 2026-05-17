import { describe, expect, it } from "vitest";
import type {
  AgentVerdict,
  Arbiter,
  ArbiterContext,
  ArbiterDecision,
  PageCapture,
} from "@scout/shared";

describe("Arbiter interface — compile-time assignability", () => {
  it("satisfies a minimal literal impl", () => {
    const impl = {
      async combine(
        _v: AgentVerdict[],
        _c: PageCapture,
        _ctx: ArbiterContext,
      ): Promise<ArbiterDecision> {
        return {
          decision: "ALLOW",
          confidence: 1.0,
          consensusCategories: [],
          consensusEntities: [],
          disagreements: [],
          humanReviewRecommended: false,
          lobstertrapTraceId: null,
        };
      },
    } satisfies Arbiter;
    expect(typeof impl.combine).toBe("function");
  });

  it("accepts an ArbiterContext literal", () => {
    const controller = new AbortController();
    const ctx: ArbiterContext = {
      advertiserId: "adv-1",
      policyId: "pol-1",
      humanReviewThreshold: 0.7,
      abortSignal: controller.signal,
    };
    expect(ctx.humanReviewThreshold).toBe(0.7);
  });
});
