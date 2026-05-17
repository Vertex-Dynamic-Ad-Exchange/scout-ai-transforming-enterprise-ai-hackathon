import type { AuditRow, Decision, PageProfile, Policy } from "@scout/shared";

// Reverse-chronological by (ts, id). ISO-8601 string compare is
// lexicographic-correct; id tiebreak guarantees a deterministic total
// order, required so cursor pagination never skips or duplicates.
function auditRowDesc(a: AuditRow, b: AuditRow): number {
  if (a.ts !== b.ts) return a.ts < b.ts ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

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

  const auditStore: AuditStore = {
    async put(row: AuditRow): Promise<void> {
      auditRows.push(row);
    },
    async query(filter: AuditQueryFilter): Promise<AuditQueryResult> {
      const rows = auditRows
        .filter((r) => r.advertiserId === filter.advertiserId)
        .slice()
        .sort(auditRowDesc);
      return { rows, nextCursor: null };
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
