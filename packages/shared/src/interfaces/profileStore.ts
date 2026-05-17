import type { PageProfile } from "../schemas/profile.js";

/**
 * Tenant-scoped page-profile cache.
 *
 * Keyed `(advertiserId, contentHash)` per PRP-A § Security guardrails — never
 * `contentHash` alone. PRP-C's `commit.ts` writes; gate's hot path reads.
 * PRP-A D17 punted the concrete shape to foundation; PRP-C lands this minimal
 * interface inline because foundation has not yet executed and the profiler
 * loop typechecks against it.
 */
export interface ProfileStore {
  /** Idempotent by `(advertiserId, profile.contentHash)`; latest-write wins. */
  put(advertiserId: string, profile: PageProfile): Promise<void>;

  /** Cache lookup; `null` on miss. */
  get(advertiserId: string, contentHash: string): Promise<PageProfile | null>;
}
