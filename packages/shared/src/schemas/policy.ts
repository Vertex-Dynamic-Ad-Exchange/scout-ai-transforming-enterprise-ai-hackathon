import { z } from "zod";
import { DecisionSchema } from "./primitives.js";

export const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["category", "entity", "creative_tag"]),
  match: z.string().min(1),
  action: DecisionSchema,
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const EscalationSchema = z.object({
  ambiguousAction: DecisionSchema,
  humanReviewThreshold: z.number().min(0).max(1),
});
export type Escalation = z.infer<typeof EscalationSchema>;

export const PolicySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  advertiserId: z.string().min(1),
  rules: z.array(PolicyRuleSchema),
  escalation: EscalationSchema,
});
export type Policy = z.infer<typeof PolicySchema>;
