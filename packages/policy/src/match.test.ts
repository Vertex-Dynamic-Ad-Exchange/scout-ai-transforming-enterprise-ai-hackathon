import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { PageProfile, Policy } from "@scout/shared";
import { PolicyMatchResultSchema, PolicySchema } from "@scout/shared";
import { CONFIDENCE_FLOOR, match } from "./match.js";

const baseProfile: PageProfile = {
  id: "profile-1",
  url: "https://example.com",
  contentHash: "hash-1",
  categories: [{ label: "news", confidence: 0.9 }],
  detectedEntities: [{ name: "OpenAI", type: "organization", confidence: 0.8 }],
  evidenceRefs: [],
  capturedAt: new Date("2026-05-15T00:00:00.000Z").toISOString(),
  ttl: 3600,
};

const basePolicy: Policy = {
  id: "policy-1",
  version: "v1",
  advertiserId: "advertiser-1",
  rules: [],
  escalation: {
    ambiguousAction: "HUMAN_REVIEW",
    humanReviewThreshold: 0.7,
  },
};

function withRule(
  kind: "category" | "entity" | "creative_tag",
  action: "ALLOW" | "DENY" | "HUMAN_REVIEW",
): Policy {
  return {
    ...basePolicy,
    rules: [
      { id: `${kind}-${action}`, kind, match: kind === "entity" ? "OpenAI" : "news", action },
    ],
  };
}

describe("policy match", () => {
  it("returns schema-valid output for baseline input", () => {
    const out = match(baseProfile, basePolicy);
    expect(() => PolicyMatchResultSchema.parse(out)).not.toThrow();
  });

  it.each([
    { kind: "category", action: "ALLOW", expected: "ALLOW" },
    { kind: "category", action: "DENY", expected: "DENY" },
    { kind: "category", action: "HUMAN_REVIEW", expected: "HUMAN_REVIEW" },
    { kind: "entity", action: "ALLOW", expected: "ALLOW" },
    { kind: "entity", action: "DENY", expected: "DENY" },
    { kind: "entity", action: "HUMAN_REVIEW", expected: "HUMAN_REVIEW" },
  ])("fires single $kind rule with $action decision", ({ kind, action, expected }) => {
    const policy = withRule(
      kind as "category" | "entity",
      action as "ALLOW" | "DENY" | "HUMAN_REVIEW",
    );
    const out = match(baseProfile, policy);
    expect(out.decision).toBe(expected);
    expect(out.firedRules).toHaveLength(1);
    expect(out.policyVersion).toBe(policy.version);
  });

  it("applies decision precedence DENY > HUMAN_REVIEW > ALLOW", () => {
    const policy: Policy = {
      ...basePolicy,
      rules: [
        { id: "allow-news", kind: "category", match: "news", action: "ALLOW" },
        { id: "review-openai", kind: "entity", match: "OpenAI", action: "HUMAN_REVIEW" },
        { id: "deny-news", kind: "category", match: "news", action: "DENY" },
      ],
    };
    const out = match(baseProfile, policy);
    expect(out.decision).toBe("DENY");
  });

  it("resolves HUMAN_REVIEW over ALLOW when DENY absent", () => {
    const policy: Policy = {
      ...basePolicy,
      rules: [
        { id: "allow-news", kind: "category", match: "news", action: "ALLOW" },
        { id: "review-openai", kind: "entity", match: "OpenAI", action: "HUMAN_REVIEW" },
      ],
    };
    const out = match(baseProfile, policy);
    expect(out.decision).toBe("HUMAN_REVIEW");
  });

  it.each(["ALLOW", "DENY", "HUMAN_REVIEW"] as const)(
    "uses ambiguousAction %s when no rule fires",
    (ambiguousAction) => {
      const policy: Policy = {
        ...basePolicy,
        rules: [{ id: "no-match", kind: "category", match: "sports", action: "DENY" }],
        escalation: { ...basePolicy.escalation, ambiguousAction },
      };
      const out = match(baseProfile, policy);
      expect(out.decision).toBe(ambiguousAction);
      expect(out.confidence).toBe(0);
      expect(out.firedRules).toEqual([]);
    },
  );

  it("enforces confidence floor boundaries for category rules", () => {
    const lowConfidenceProfile: PageProfile = {
      ...baseProfile,
      categories: [{ label: "news", confidence: CONFIDENCE_FLOOR - 0.01 }],
    };
    const highConfidenceProfile: PageProfile = {
      ...baseProfile,
      categories: [{ label: "news", confidence: CONFIDENCE_FLOOR + 0.01 }],
    };
    const policy = withRule("category", "ALLOW");

    const lowOut = match(lowConfidenceProfile, policy);
    const highOut = match(highConfidenceProfile, policy);

    expect(lowOut.firedRules).toHaveLength(0);
    expect(highOut.firedRules).toHaveLength(1);
  });

  it("computes noisy-OR confidence for corroborating winning signals", () => {
    const profile: PageProfile = {
      ...baseProfile,
      categories: [{ label: "news", confidence: 0.5 }],
      detectedEntities: [{ name: "OpenAI", type: "organization", confidence: 0.5 }],
    };
    const policy: Policy = {
      ...basePolicy,
      rules: [
        { id: "allow-news", kind: "category", match: "news", action: "ALLOW" },
        { id: "allow-openai", kind: "entity", match: "OpenAI", action: "ALLOW" },
      ],
    };
    const out = match(profile, policy);
    expect(out.decision).toBe("ALLOW");
    expect(out.confidence).toBeCloseTo(0.75, 6);
  });

  it("is deterministic for deep-equal inputs", () => {
    const p1 = structuredClone(baseProfile);
    const p2 = structuredClone(baseProfile);
    const policy = structuredClone(withRule("entity", "ALLOW"));
    const first = match(p1, policy);
    const second = match(p2, structuredClone(policy));
    const third = match(p1, policy);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("sorts firedRules lexicographically by ruleId", () => {
    const policy: Policy = {
      ...basePolicy,
      rules: [
        { id: "z-rule", kind: "category", match: "news", action: "ALLOW" },
        { id: "a-rule", kind: "entity", match: "OpenAI", action: "ALLOW" },
        { id: "m-rule", kind: "category", match: "news", action: "ALLOW" },
      ],
    };
    const out = match(baseProfile, policy);
    expect(out.firedRules.map((rule) => rule.ruleId)).toEqual(["a-rule", "m-rule", "z-rule"]);
  });

  it("does not fire creative_tag rules from category/entity strings", () => {
    const policy: Policy = {
      ...basePolicy,
      rules: [{ id: "creative", kind: "creative_tag", match: "news", action: "DENY" }],
    };
    const out = match(baseProfile, policy);
    expect(out.firedRules).toEqual([]);
    expect(out.decision).toBe(policy.escalation.ambiguousAction);
  });

  it("fixtures parse as valid Policy schema", async () => {
    const fixtureDir = new URL("../fixtures/", import.meta.url);
    const fixtureNames = [
      "brand-safe-news.json",
      "gambling-strict.json",
      "permissive-baseline.json",
    ];
    for (const fixtureName of fixtureNames) {
      const raw = await readFile(new URL(fixtureName, fixtureDir), "utf8");
      const parsed: unknown = JSON.parse(raw);
      expect(() => PolicySchema.parse(parsed)).not.toThrow();
    }
  });
});
