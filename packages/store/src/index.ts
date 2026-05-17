import { randomUUID } from "node:crypto";
import type { AuditRow, Decision, PageProfile, Policy } from "@scout/shared";

const AUDIT_LIMIT_DEFAULT = 50;
const AUDIT_LIMIT_MAX = 200;
const AUDIT_CURSOR_TTL_MS = 5 * 60 * 1000;

// Reverse-chronological by (ts, id). ISO-8601 string compare is
// lexicographic-correct; id tiebreak guarantees a deterministic total
// order, required so cursor pagination never skips or duplicates.
function auditRowDesc(a: AuditRow, b: AuditRow): number {
  if (a.ts !== b.ts) return a.ts < b.ts ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

// The discriminated `AuditRow` carries `pageUrl` in different places
// per variant: the verdict variant exposes it under `request.pageUrl`;
// the DLQ variant carries it at the top level.
function rowPageUrl(row: AuditRow): string {
  return row.kind === "verdict" ? row.request.pageUrl : row.pageUrl;
}

// Strict reverse-chrono ordering: a row is "older" than the anchor if
// its (ts, id) tuple is less in the same lex sense `auditRowDesc` uses.
function isStrictlyOlder(row: AuditRow, anchor: { ts: string; id: string }): boolean {
  if (row.ts !== anchor.ts) return row.ts < anchor.ts;
  return row.id < anchor.id;
}

function matchesFilter(row: AuditRow, filter: AuditQueryFilter): boolean {
  if (row.advertiserId !== filter.advertiserId) return false;
  if (filter.kind !== undefined && row.kind !== filter.kind) return false;
  if (filter.since !== undefined && row.ts < filter.since) return false;
  if (filter.until !== undefined && row.ts > filter.until) return false;
  if (filter.pageUrl !== undefined && rowPageUrl(row) !== filter.pageUrl) return false;
  // `decision` is a verdict-only field — DLQ rows are excluded by definition.
  if (filter.decision !== undefined) {
    if (row.kind !== "verdict") return false;
    if (row.verdict.decision !== filter.decision) return false;
  }
  return true;
}

// PRP-B Cluster B queue. NOTE: implements @scout/shared's ProfileQueue, which
// is DIFFERENT from the local `ProfileQueue` interface in this file (cluster
// A↔B drift surfaced after main merge 6ed0ebb). Re-exported here so profiler
// tests + smoke script can resolve through @scout/store's public entry.
// Follow-up: reconcile the two interfaces in a dedicated PRP.
export { InMemoryProfileQueue } from "./inMemoryProfileQueue.js";
export type { InMemoryProfileQueueOptions } from "./inMemoryProfileQueue.js";

export interface ProfileStore {
  get(url: string, contentHash?: string): Promise<PageProfile | null>;
  put(profile: PageProfile): Promise<void>;
}

export interface PolicyStore {
  // ALWAYS tenant-scoped: never call without advertiserId
  get(policyId: string, advertiserId: string): Promise<Policy | null>;
}

export interface AuditQueryFilter {
  advertiserId: string; // REQUIRED — tenant scope. No overload without it.
  since?: string; // ISO-8601 datetime
  until?: string;
  decision?: Decision;
  pageUrl?: string; // exact match; v1 not substring
  kind?: "verdict" | "profile_job_dlq";
  limit?: number; // ≤ 200, default 50
  cursor?: string; // opaque pagination token
}

export interface AuditQueryResult {
  rows: AuditRow[];
  nextCursor: string | null;
}

export interface AuditStore {
  put(row: AuditRow): Promise<void>;
  query(filter: AuditQueryFilter): Promise<AuditQueryResult>;
  get(advertiserId: string, id: string): Promise<AuditRow | null>;
}

export interface ProfileJob {
  url: string;
  advertiserId: string;
  policyId: string;
  requestedAt: string; // ISO datetime
}

export interface ProfileQueue {
  enqueue(job: ProfileJob): Promise<void>;
}

export interface StoreConfig {
  redisUrl?: string;
  initialPolicies?: Policy[];
}

export function createStores(_config?: StoreConfig): {
  profileStore: ProfileStore;
  policyStore: PolicyStore;
  auditStore: AuditStore;
  profileQueue: ProfileQueue;
} {
  const profiles = new Map<string, PageProfile>();
  const policies = new Map<string, Policy>();
  for (const policy of _config?.initialPolicies ?? []) {
    policies.set(`${policy.advertiserId}:${policy.id}`, policy);
  }

  const profileStore: ProfileStore = {
    async get(url: string): Promise<PageProfile | null> {
      return profiles.get(url) ?? null;
    },
    async put(profile: PageProfile): Promise<void> {
      profiles.set(profile.url, profile);
    },
  };

  const policyStore: PolicyStore = {
    async get(policyId: string, advertiserId: string): Promise<Policy | null> {
      return policies.get(`${advertiserId}:${policyId}`) ?? null;
    },
  };

  const auditRows: AuditRow[] = [];
  // Server-side cursor state (D1). The token is an opaque
  // `base64url(randomUUID())` string; the anchor is held here, not in
  // the cursor itself, so a caller cannot forge a cross-tenant pivot.
  // The SQLite/Redis impl can swap to HMAC; the interface is identical.
  const cursorTokens = new Map<
    string,
    { advertiserId: string; ts: string; id: string; lastAccess: number }
  >();

  function issueCursor(anchor: { advertiserId: string; ts: string; id: string }): string {
    const token = Buffer.from(randomUUID()).toString("base64url");
    cursorTokens.set(token, { ...anchor, lastAccess: Date.now() });
    return token;
  }

  function resolveCursor(
    token: string,
  ): { advertiserId: string; ts: string; id: string } | null {
    const entry = cursorTokens.get(token);
    if (entry === undefined) return null;
    if (Date.now() - entry.lastAccess > AUDIT_CURSOR_TTL_MS) {
      cursorTokens.delete(token);
      return null;
    }
    entry.lastAccess = Date.now();
    return { advertiserId: entry.advertiserId, ts: entry.ts, id: entry.id };
  }

  const auditStore: AuditStore = {
    async put(row: AuditRow): Promise<void> {
      auditRows.push(row);
    },
    /**
     * Reverse-chronological tenant-scoped read.
     *
     * `cursor` is opaque. A forged or expired cursor, and a cursor
     * issued for advertiser A replayed under advertiser B, both
     * resolve to `{ rows: [], nextCursor: null }` (D7) — no error
     * is raised so cross-tenant enumeration cannot distinguish
     * "invalid cursor" from "no rows for you". `limit > 200` is a
     * caller bug and throws RangeError (D3).
     */
    async query(filter: AuditQueryFilter): Promise<AuditQueryResult> {
      const limit = filter.limit ?? AUDIT_LIMIT_DEFAULT;
      if (limit > AUDIT_LIMIT_MAX) {
        throw new RangeError("limit exceeds 200");
      }

      let candidates = auditRows
        .filter((r) => matchesFilter(r, filter))
        .slice()
        .sort(auditRowDesc);

      if (filter.cursor !== undefined) {
        const anchor = resolveCursor(filter.cursor);
        if (anchor === null || anchor.advertiserId !== filter.advertiserId) {
          return { rows: [], nextCursor: null };
        }
        candidates = candidates.filter((r) => isStrictlyOlder(r, anchor));
      }

      const rows = candidates.slice(0, limit);
      const last = rows[rows.length - 1];
      const hasMore = candidates.length > rows.length;
      const nextCursor =
        hasMore && last !== undefined
          ? issueCursor({ advertiserId: filter.advertiserId, ts: last.ts, id: last.id })
          : null;
      return { rows, nextCursor };
    },
    async get(advertiserId: string, id: string): Promise<AuditRow | null> {
      return (
        auditRows.find((r) => r.advertiserId === advertiserId && r.id === id) ?? null
      );
    },
  };

  const profileQueue: ProfileQueue = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async enqueue(_job: ProfileJob): Promise<void> {
      // In-memory: no persistence; production impl uses ioredis queue
    },
  };

  return { profileStore, policyStore, auditStore, profileQueue };
}
