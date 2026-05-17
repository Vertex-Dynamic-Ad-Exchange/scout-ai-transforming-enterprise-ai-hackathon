import type { AgentVerdict, VerifierKind } from "../schemas/agentVerdict.js";
import type { PageCapture } from "../schemas/capture.js";
import type { DegradationHint } from "../schemas/job.js";

/**
 * Construction-time context passed to every `Verifier.verify` call.
 *
 * The `Verifier` is the seam where each verifier→LLM call routes through
 * Lobster Trap; real Cluster C verifiers consume an `LlmClient` from
 * `@scout/llm-client` (the Lobster Trap proxy). This interface stays in
 * `@scout/shared` (no `LlmClient` import) so the agent packages can land
 * without pulling the LLM client prematurely.
 */
export interface VerifierContext {
  advertiserId: string;
  policyId: string;
  taxonomyHint?: string[];
  degradationHint: DegradationHint;
  abortSignal: AbortSignal;
}

export interface Verifier {
  readonly kind: VerifierKind;
  verify(capture: PageCapture, ctx: VerifierContext): Promise<AgentVerdict>;
}
