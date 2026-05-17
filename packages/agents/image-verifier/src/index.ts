import type { AgentVerdict, PageCapture, Verifier, VerifierContext } from "@scout/shared";

/**
 * Stub upgrade per PRP-A § Agent stub target shape. See text-verifier for the
 * controlling rationale; this is the mechanical mirror with `kind: "image"`.
 */
export function createImageVerifier(_deps?: { llm?: unknown }): Verifier {
  return {
    kind: "image",
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
  };
}
