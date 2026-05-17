import { z } from "zod";
import { BidVerificationRequestSchema } from "./bid.js";
import { PageProfileSchema } from "./profile.js";
import { VerificationVerdictSchema } from "./verdict.js";
import { LobstertrapDeclaredIntentSchema, LobstertrapDetectedIntentSchema } from "./intent.js";

const AuditRowBase = {
  id: z.string().min(1),
  advertiserId: z.string().min(1),
  ts: z.string().datetime(),
};

export const AuditRowVerdictSchema = z.object({
  kind: z.literal("verdict"),
  ...AuditRowBase,
  request: BidVerificationRequestSchema,
  verdict: VerificationVerdictSchema,
  profile: PageProfileSchema.nullable(),
  declaredIntent: LobstertrapDeclaredIntentSchema.nullable(),
  detectedIntent: LobstertrapDetectedIntentSchema.nullable(),
});
export type AuditRowVerdict = z.infer<typeof AuditRowVerdictSchema>;

export const AuditRowProfileJobDlqSchema = z.object({
  kind: z.literal("profile_job_dlq"),
  ...AuditRowBase,
  jobId: z.string().min(1),
  pageUrl: z.string().url(),
  attempts: z.number().int().positive(),
  nackReason: z.string().min(1),
});
export type AuditRowProfileJobDlq = z.infer<typeof AuditRowProfileJobDlqSchema>;

export const AuditRowSchema = z.discriminatedUnion("kind", [
  AuditRowVerdictSchema,
  AuditRowProfileJobDlqSchema,
]);
export type AuditRow = z.infer<typeof AuditRowSchema>;
