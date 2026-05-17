import type {
  AgentVerdict,
  DegradationHint,
  Logger,
  PageCapture,
  Verifier,
  VerifierContext,
  VerifierKind,
} from "@scout/shared";

export interface FanoutDeps {
  verifiers: { text: Verifier; image: Verifier; video: Verifier };
  logger: Logger;
}

export interface FanoutCtx {
  advertiserId: string;
  policyId: string;
  abortSignal: AbortSignal;
  verifierTimeoutMs: number;
  degradationHint: DegradationHint;
}

/**
 * Fans the three verifiers out in parallel via `Promise.allSettled`.
 *
 * Kind set: `[text, image]` plus `video` iff the capture has video samples AND
 * the job's `degradationHint !== "drop_video"`. PRP-D will layer the floor +
 * rolling-window ceiling on top.
 *
 * Per-call abort: `AbortSignal.any([loopSignal, AbortSignal.timeout(timeout)])`
 * (D11). On rejection — sync throw, async reject, or timeout abort — synthesize
 * a `HUMAN_REVIEW` placeholder (D12) so the arbiter always sees the same shape.
 */
export async function fanout(
  deps: FanoutDeps,
  capture: PageCapture,
  ctx: FanoutCtx,
): Promise<AgentVerdict[]> {
  const kinds: VerifierKind[] = ["text", "image"];
  if (capture.videoSamples.length > 0 && ctx.degradationHint !== "drop_video") {
    kinds.push("video");
  }
  const settled = await Promise.allSettled(
    kinds.map(async (kind) => {
      const signal = AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(ctx.verifierTimeoutMs)]);
      const vctx: VerifierContext = {
        advertiserId: ctx.advertiserId,
        policyId: ctx.policyId,
        degradationHint: ctx.degradationHint,
        abortSignal: signal,
      };
      return deps.verifiers[kind].verify(capture, vctx);
    }),
  );
  return settled.map((result, i) => {
    const kind = kinds[i]!;
    if (result.status === "fulfilled") return result.value;
    deps.logger.warn({
      event: "verifier_rejected",
      verifier: kind,
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
    });
    return synthHumanReview(kind);
  });
}

function synthHumanReview(kind: VerifierKind): AgentVerdict {
  return {
    verifier: kind,
    decision: "HUMAN_REVIEW",
    categories: [],
    detectedEntities: [],
    evidenceRefs: [],
    modelLatencyMs: 0,
    lobstertrapTraceId: null,
  };
}
