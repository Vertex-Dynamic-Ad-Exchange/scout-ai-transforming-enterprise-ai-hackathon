import { describe, expect, it } from "vitest";
import type { Policy } from "@scout/shared";
import { createStores } from "@scout/store";

describe("tenant isolation contract", () => {
  it("returns null for cross-tenant PolicyStore.get lookups", async () => {
    const policy: Policy = {
      id: "policy-tenant-a",
      version: "v1",
      advertiserId: "advertiser-a",
      rules: [{ id: "deny-news", kind: "category", match: "news", action: "DENY" }],
      escalation: { ambiguousAction: "DENY", humanReviewThreshold: 0.7 },
    };

    const stores = createStores({ initialPolicies: [policy] });

    const sameTenant = await stores.policyStore.get(policy.id, "advertiser-a");
    const wrongTenant = await stores.policyStore.get(policy.id, "advertiser-b");
    const unknownPolicy = await stores.policyStore.get("missing-policy", "advertiser-b");

    expect(sameTenant?.id).toBe(policy.id);
    expect(wrongTenant).toBeNull();
    expect(unknownPolicy).toBeNull();
  });
});
