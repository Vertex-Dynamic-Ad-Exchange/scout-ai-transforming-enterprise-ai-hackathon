import { z } from "zod";

// Reused regex shape from packages/shared/src/schemas/bid.ts (BidVerificationRequest.geo)
// and packages/shared/src/schemas/capture.ts (CaptureOptions.geo). Per PRP Task 6
// note (mirrors harness-contracts.md), do NOT factor into primitives.ts here — defer
// until there is a third caller.
const Alpha2 = z.string().regex(/^[A-Z]{2}$/);

export const DegradationHintSchema = z.enum(["none", "drop_video", "collapse_text_image"]);
export type DegradationHint = z.infer<typeof DegradationHintSchema>;

/**
 * Warm-path job. Gate enqueues on cache miss; profiler consumes.
 *
 * - `id` is the idempotency key. Full ULID regex is pinned in PRP-B's generator test;
 *   here `min(1)` is enough to gate empty strings.
 * - `degradationHint` from the enqueuer is the FLOOR; PRP-D's cost trip-wire may
 *   upgrade severity in flight but never downgrades below this.
 */
export const ProfileJobSchema = z.object({
  id: z.string().min(1),
  pageUrl: z.string().url(),
  advertiserId: z.string().min(1),
  policyId: z.string().min(1),
  geo: Alpha2,
  enqueuedAt: z.string().datetime(),
  attempt: z.number().int().min(1),
  degradationHint: DegradationHintSchema,
});
export type ProfileJob = z.infer<typeof ProfileJobSchema>;
