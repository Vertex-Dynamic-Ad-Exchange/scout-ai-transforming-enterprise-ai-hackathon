import { vi } from "vitest";
import type { GateDeps } from "./handler.js";
import type { PageProfile, Policy } from "@scout/shared";
import type { PolicyMatchResult } from "@scout/policy";

export const now = new Date().toISOString();

export const validProfile: PageProfile = {
  id: "profile-1",
  url: "https://example.com",
  contentHash: "abc123",
  categories: [{ label: "news", confidence: 0.9 }],
  detectedEntities: [{ name: "OpenAI", type: "organization", confidence: 0.8 }],
  evidenceRefs: [],
  capturedAt: new Date(Date.now() - 60_000).toISOString(),
  ttl: 3600,
};

export const validPolicy: Policy = {
  id: "pol1",
  version: "v1",
  advertiserId: "adv1",
  rules: [{ id: "r1", kind: "category", match: "news", action: "ALLOW" }],
  escalation: { ambiguousAction: "ALLOW", humanReviewThreshold: 0.7 },
};

export const clearAllowResult: PolicyMatchResult = {
  decision: "ALLOW",
  confidence: 0.9,
  firedRules: [{ ruleId: "r1", kind: "category", signalConfidence: 0.9 }],
  policyVersion: "v1",
};

export const clearDenyResult: PolicyMatchResult = {
  decision: "DENY",
  confidence: 0.95,
  firedRules: [{ ruleId: "r1", kind: "category", signalConfidence: 0.95 }],
  policyVersion: "v1",
};

export const ambiguousResult: PolicyMatchResult = {
  decision: "DENY",
  confidence: 0.5,
  firedRules: [{ ruleId: "r1", kind: "category", signalConfidence: 0.5 }],
  policyVersion: "v1",
};

export const humanReviewResult: PolicyMatchResult = {
  decision: "HUMAN_REVIEW",
  confidence: 0.6,
  firedRules: [],
  policyVersion: "v1",
};

export const validBody = {
  advertiserId: "adv1",
  policyId: "pol1",
  pageUrl: "https://example.com",
  creativeRef: "cr1",
  geo: "US",
  ts: now,
};

export function buildDeps(overrides: Partial<GateDeps> = {}): GateDeps {
  return {
    profileStore: {
      get: vi.fn().mockResolvedValue(validProfile),
      put: vi.fn().mockResolvedValue(undefined),
    },
    policyStore: { get: vi.fn().mockResolvedValue(validPolicy) },
    auditStore: {
      put: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
      get: vi.fn().mockResolvedValue(null),
    },
    profileQueue: { enqueue: vi.fn().mockResolvedValue(undefined) },
    llmClient: { chat: vi.fn(), healthcheck: vi.fn() },
    policyMatcher: { match: vi.fn().mockReturnValue(clearAllowResult) },
    ...overrides,
  };
}

export function waitForSetImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
