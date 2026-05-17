import { describe, expect, it } from "vitest";
import { createStores } from "@scout/store";
import type { BidVerificationRequest, Policy } from "@scout/shared";
import { seedScenario, seedPolicies } from "../seeder.js";
import type { Scenario } from "../types.js";

const SEEDER_HAPPY_URL = "https://example.com/test-seeder-happy";
const SEEDER_MALFORMED_URL = "https://example.com/test-seeder-malformed";

function buildBid(pageUrl: string, advertiserId: string, policyId: string): BidVerificationRequest {
  return {
    advertiserId,
    policyId,
    pageUrl,
    creativeRef: "creative-test",
    geo: "US",
    ts: "2026-05-17T00:00:00Z",
  };
}

const inlinePolicy = (): Policy => ({
  id: "policy-test-seeder",
  version: "v1",
  advertiserId: "advertiser-test",
  rules: [{ id: "rule-news", kind: "category", match: "News", action: "ALLOW" }],
  escalation: { ambiguousAction: "ALLOW", humanReviewThreshold: 0.7 },
});

function happyScenario(policy: Policy): Scenario {
  return {
    formatVersion: "1.0",
    name: "seeder-happy",
    description: "",
    seeds: { profiles: ["_test-seeder-happy"], policies: [policy.id] },
    bids: [{ delayMs: 0, request: buildBid(SEEDER_HAPPY_URL, policy.advertiserId, policy.id) }],
    expectations: [{ latencyMsMax: 1, lobstertrapTraceIdNullable: true }],
  };
}

describe("seedScenario — Task 7 happy path", () => {
  it("seeds profile from _test- fixture; policy resolves via initialPolicies", async () => {
    const policy = inlinePolicy();
    const stores = createStores({ initialPolicies: [policy] });
    await seedScenario(happyScenario(policy), stores);
    const profile = await stores.profileStore.get(SEEDER_HAPPY_URL);
    expect(profile).not.toBeNull();
    expect(profile?.url).toBe(SEEDER_HAPPY_URL);
    expect(profile?.categories[0]?.label).toBe("News");
    const reloadedPolicy = await stores.policyStore.get(policy.id, policy.advertiserId);
    expect(reloadedPolicy?.id).toBe(policy.id);
  });
});

describe("seedScenario — Task 8 edge: idempotent re-seed", () => {
  it("second call does not throw; latest write wins (Map.set semantics)", async () => {
    const policy = inlinePolicy();
    const stores = createStores({ initialPolicies: [policy] });
    const scenario = happyScenario(policy);
    await seedScenario(scenario, stores);
    await expect(seedScenario(scenario, stores)).resolves.toBeUndefined();
    const profile = await stores.profileStore.get(SEEDER_HAPPY_URL);
    expect(profile?.id).toBe("profile-test-seeder-happy");
  });
});

describe("seedScenario — Task 9 failure: malformed fixture", () => {
  it("throws on ttl: -1 (PageProfileSchema.ttl is .positive()) and never reaches profileStore.put", async () => {
    const policy = inlinePolicy();
    const stores = createStores({ initialPolicies: [policy] });
    const scenario: Scenario = {
      formatVersion: "1.0",
      name: "seeder-malformed",
      description: "",
      seeds: { profiles: ["_test-seeder-malformed"], policies: [] },
      bids: [
        { delayMs: 0, request: buildBid(SEEDER_MALFORMED_URL, policy.advertiserId, policy.id) },
      ],
      expectations: [{ latencyMsMax: 1, lobstertrapTraceIdNullable: true }],
    };
    await expect(seedScenario(scenario, stores)).rejects.toThrow();
    const profile = await stores.profileStore.get(SEEDER_MALFORMED_URL);
    expect(profile).toBeNull();
  });
});

describe("seedPolicies — reads packages/policy/fixtures by ID", () => {
  it("returns parsed Policy[] for a real fixture (brand-safe-news)", async () => {
    const scenario: Scenario = {
      formatVersion: "1.0",
      name: "seedPolicies-smoke",
      description: "",
      seeds: { profiles: [], policies: ["brand-safe-news"] },
      bids: [{ delayMs: 0, request: buildBid("https://example.com/", "advertiser-news", "any") }],
      expectations: [{ latencyMsMax: 1, lobstertrapTraceIdNullable: true }],
    };
    const policies = await seedPolicies(scenario);
    expect(policies).toHaveLength(1);
    expect(policies[0]?.id).toBe("policy-brand-safe-news");
  });
});
