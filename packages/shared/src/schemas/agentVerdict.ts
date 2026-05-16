import { z } from "zod";
import { DecisionSchema } from "./primitives.js";
import { CategorySchema, DetectedEntitySchema, EvidenceRefSchema } from "./profile.js";

export const VerifierKindSchema = z.enum(["text", "image", "video"]);
export type VerifierKind = z.infer<typeof VerifierKindSchema>;

/**
 * One verifier's verdict on a `PageCapture`.
 *
 * `lobstertrapTraceId: null` ONLY on the no-LLM degraded path (D10). An empty
 * string is NOT the null sentinel — PRP-C's loop asserts non-null on every
 * non-degraded job to make the Veea-Award audit-chain claim executable.
 */
export const AgentVerdictSchema = z.object({
  verifier: VerifierKindSchema,
  decision: DecisionSchema,
  categories: z.array(CategorySchema),
  detectedEntities: z.array(DetectedEntitySchema),
  evidenceRefs: z.array(EvidenceRefSchema),
  modelLatencyMs: z.number().int().nonnegative(),
  lobstertrapTraceId: z.string().min(1).nullable(),
});
export type AgentVerdict = z.infer<typeof AgentVerdictSchema>;

/**
 * Arbiter-flagged disagreement between verifiers (D12). All three perVerifier
 * keys are required so the dashboard does not have to special-case missing
 * cardinality.
 */
export const DisagreementSchema = z.object({
  kind: z.enum(["category", "entity"]),
  label: z.string().min(1),
  perVerifier: z.object({
    text: z.number(),
    image: z.number(),
    video: z.number(),
  }),
});
export type Disagreement = z.infer<typeof DisagreementSchema>;

/**
 * Output of `Arbiter.combine`. `confidence` is on the same `[0,1]` scale as
 * `PolicyMatchResult.confidence` (D11) so the gate's ambiguity dial stays
 * consistent across hot and warm paths.
 */
export const ArbiterDecisionSchema = z.object({
  decision: DecisionSchema,
  confidence: z.number().min(0).max(1),
  consensusCategories: z.array(CategorySchema),
  consensusEntities: z.array(DetectedEntitySchema),
  disagreements: z.array(DisagreementSchema),
  humanReviewRecommended: z.boolean(),
  lobstertrapTraceId: z.string().min(1).nullable(),
});
export type ArbiterDecision = z.infer<typeof ArbiterDecisionSchema>;
