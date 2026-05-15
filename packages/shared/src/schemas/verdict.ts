import { z } from "zod";
import { DecisionSchema } from "./primitives.js";

export const ReasonSchema = z.object({
  kind: z.enum(["profile_signal", "policy_rule", "arbiter_disagreement", "fail_closed"]),
  ref: z.string().min(1),
  detail: z.string(),
});
export type Reason = z.infer<typeof ReasonSchema>;

export const VerificationVerdictSchema = z.object({
  decision: DecisionSchema,
  reasons: z.array(ReasonSchema),
  profileId: z.string().nullable(),
  policyVersion: z.string(),
  latencyMs: z.number().int().nonnegative(),
  lobstertrapTraceId: z.string().nullable(),
});
export type VerificationVerdict = z.infer<typeof VerificationVerdictSchema>;
