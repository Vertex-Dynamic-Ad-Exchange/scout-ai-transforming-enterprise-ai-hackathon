import type { AgentVerdict, ArbiterDecision } from "../schemas/agentVerdict.js";
import type { PageCapture } from "../schemas/capture.js";

/**
 * Construction-time context passed to every `Arbiter.combine` call.
 *
 * `humanReviewThreshold` is set by the profiler (PRP-C) from policy data
 * available at enqueue time; the arbiter does NOT load `Policy` itself
 * — tenancy stays on the gate's side.
 */
export interface ArbiterContext {
  advertiserId: string;
  policyId: string;
  humanReviewThreshold: number;
  abortSignal: AbortSignal;
}

export interface Arbiter {
  combine(
    verdicts: AgentVerdict[],
    capture: PageCapture,
    ctx: ArbiterContext,
  ): Promise<ArbiterDecision>;
}
