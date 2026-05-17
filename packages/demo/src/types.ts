import { z } from "zod";
import { BidVerificationRequestSchema, VerificationVerdictSchema } from "@scout/shared";

export const SeedsSchema = z
  .object({
    profiles: z.array(z.string().min(1)),
    policies: z.array(z.string().min(1)),
  })
  .strict();
export type Seeds = z.infer<typeof SeedsSchema>;

export const ReasonKindSchema = z.enum([
  "profile_signal",
  "policy_rule",
  "arbiter_disagreement",
  "fail_closed",
]);
export type ReasonKind = z.infer<typeof ReasonKindSchema>;

export const RecordedBidSchema = z
  .object({
    delayMs: z.number().int().nonnegative(),
    request: z.unknown(),
  })
  .strict();
export type RecordedBid = z.infer<typeof RecordedBidSchema>;

export const ExpectationSchema = z
  .object({
    decision: z.enum(["ALLOW", "DENY", "HUMAN_REVIEW"]).optional(),
    reasonKinds: z.array(ReasonKindSchema).optional(),
    latencyMsMax: z.number().int().positive(),
    lobstertrapTraceIdNullable: z.boolean(),
  })
  .strict();
export type Expectation = z.infer<typeof ExpectationSchema>;

export const ScenarioSchema = z
  .object({
    formatVersion: z.literal("1.0"),
    name: z.string().min(1),
    description: z.string(),
    seeds: SeedsSchema,
    bids: z.array(RecordedBidSchema).min(1),
    expectations: z.array(ExpectationSchema),
  })
  .strict()
  .refine((s) => s.bids.length === s.expectations.length, {
    message: "expectations.length must equal bids.length (one-to-one)",
    path: ["expectations"],
  });
export type Scenario = z.infer<typeof ScenarioSchema>;

export function loadScenario(json: unknown): Scenario {
  const scenario = ScenarioSchema.parse(json);
  scenario.bids.forEach((bid) => {
    BidVerificationRequestSchema.parse(bid.request);
  });
  const verdictPartial = VerificationVerdictSchema.partial();
  scenario.expectations.forEach((exp) => {
    const subset: Record<string, unknown> = {};
    if (exp.decision !== undefined) subset.decision = exp.decision;
    verdictPartial.parse(subset);
  });
  return scenario;
}
