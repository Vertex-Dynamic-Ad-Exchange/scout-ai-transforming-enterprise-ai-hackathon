import { z } from "zod";
import { DecisionSchema } from "./primitives.js";

export const FiredRuleSchema = z.object({
  ruleId: z.string().min(1),
  kind: z.enum(["category", "entity", "creative_tag"]),
  signalConfidence: z.number().min(0).max(1),
});
export type FiredRule = z.infer<typeof FiredRuleSchema>;

export const PolicyMatchResultSchema = z.object({
  decision: DecisionSchema,
  confidence: z.number().min(0).max(1),
  firedRules: z.array(FiredRuleSchema),
  policyVersion: z.string().min(1),
});
export type PolicyMatchResult = z.infer<typeof PolicyMatchResultSchema>;
