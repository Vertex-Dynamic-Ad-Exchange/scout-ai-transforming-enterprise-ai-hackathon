import { z } from "zod";

export const BidVerificationRequestSchema = z.object({
  advertiserId: z.string().min(1),
  policyId: z.string().min(1),
  pageUrl: z.string().url(),
  creativeRef: z.string().min(1),
  geo: z.string().regex(/^[A-Z]{2}$/),
  ts: z.string().datetime(),
});
export type BidVerificationRequest = z.infer<typeof BidVerificationRequestSchema>;
