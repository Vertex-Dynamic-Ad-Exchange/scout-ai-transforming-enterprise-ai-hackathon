import { z } from "zod";

export const DecisionSchema = z.enum(["ALLOW", "DENY", "HUMAN_REVIEW"]);
export type Decision = z.infer<typeof DecisionSchema>;
