import type {
  AgentVerdict,
  Arbiter,
  ArbiterContext,
  ArbiterDecision,
  PageCapture,
} from "@scout/shared";

/**
 * Stub upgrade per PRP-A § Agent stub target shape.
 *
 * Returns a fixed `ArbiterDecision` that `satisfies Arbiter`. Cluster C
 * (`agent-arbiter-scoring.md`) swaps the body for real disagreement
 * detection + confidence blending. `deps.llm` is `unknown` (D15) so this
 * package does not couple to `@scout/llm-client` prematurely.
 */
export function createArbiter(_deps?: { llm?: unknown }): Arbiter {
  return {
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
  };
}
