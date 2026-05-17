import type { AgentVerdict, PageCapture, Verifier, VerifierContext } from "@scout/shared";

/**
 * Stub upgrade per PRP-A § Agent stub target shape.
 *
 * Returns a fixed `AgentVerdict` that `satisfies Verifier`. Cluster C swaps
 * the body for the real prompt + `LlmClient` call. `deps.llm` is `unknown`
 * (D15) so this package does NOT pull `@scout/llm-client` prematurely; the
 * real verifier will type it as `LlmClient`.
 */
export function createTextVerifier(_deps?: { llm?: unknown }): Verifier {
  return {
    kind: "text",
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
  };
}
