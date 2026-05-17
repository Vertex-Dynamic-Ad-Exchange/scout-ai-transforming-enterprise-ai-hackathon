import type { AuditRow, PageProfile, Policy } from "@scout/shared";

export interface ProfileStore {
  get(url: string, contentHash?: string): Promise<PageProfile | null>;
  put(profile: PageProfile): Promise<void>;
}

export interface PolicyStore {
  // ALWAYS tenant-scoped: never call without advertiserId
  get(policyId: string, advertiserId: string): Promise<Policy | null>;
}

export interface AuditStore {
  put(row: AuditRow): Promise<void>;
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

  const auditStore: AuditStore = {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async put(_row: AuditRow): Promise<void> {
      // In-memory: no persistence; production impl uses ioredis/sqlite
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
