import { describe, expect, it } from "vitest";
import { LobstertrapDeclaredIntentSchema, LobstertrapDetectedIntentSchema } from "@scout/shared";

describe("LobstertrapDeclaredIntentSchema (happy path)", () => {
  it("parses a hand-built valid literal", () => {
    const parsed = LobstertrapDeclaredIntentSchema.parse({
      declared_intent: "classify page against policy",
      agent_id: "gate-flash",
    });
    expect(parsed.declared_intent).toBe("classify page against policy");
    expect(parsed.agent_id).toBe("gate-flash");
  });
});

describe("LobstertrapDeclaredIntentSchema — declared_paths (optional)", () => {
  it("accepts an empty array", () => {
    const parsed = LobstertrapDeclaredIntentSchema.parse({
      declared_intent: "classify",
      agent_id: "gate-flash",
      declared_paths: [],
    });
    expect(parsed.declared_paths).toEqual([]);
  });

  it("accepts a populated array", () => {
    const parsed = LobstertrapDeclaredIntentSchema.parse({
      declared_intent: "classify",
      agent_id: "gate-flash",
      declared_paths: ["/foo", "/bar"],
    });
    expect(parsed.declared_paths).toEqual(["/foo", "/bar"]);
  });

  it("accepts the key being omitted entirely", () => {
    const parsed = LobstertrapDeclaredIntentSchema.parse({
      declared_intent: "classify",
      agent_id: "gate-flash",
    });
    expect(parsed.declared_paths).toBeUndefined();
  });
});

describe("LobstertrapDeclaredIntentSchema — failure cases", () => {
  it("rejects empty declared_intent (.min(1))", () => {
    expect(() =>
      LobstertrapDeclaredIntentSchema.parse({
        declared_intent: "",
        agent_id: "gate-flash",
      }),
    ).toThrow();
  });

  it("rejects a missing agent_id", () => {
    expect(() =>
      LobstertrapDeclaredIntentSchema.parse({
        declared_intent: "classify",
      }),
    ).toThrow();
  });

  it("throws on parse(null)", () => {
    expect(() => LobstertrapDeclaredIntentSchema.parse(null)).toThrow();
  });
});

describe("LobstertrapDetectedIntentSchema (happy path)", () => {
  it("parses the cached-clean case (divergence + evidence null)", () => {
    const parsed = LobstertrapDetectedIntentSchema.parse({
      detected_intent: "classification",
      divergence: null,
      evidence: null,
    });
    expect(parsed.detected_intent).toBe("classification");
    expect(parsed.divergence).toBeNull();
    expect(parsed.evidence).toBeNull();
  });
});

describe("LobstertrapDetectedIntentSchema — divergence carried", () => {
  it("accepts non-null divergence + evidence (the caught-divergence case)", () => {
    const parsed = LobstertrapDetectedIntentSchema.parse({
      detected_intent: "instruction-override",
      divergence:
        "declared scope was classification; detected scope expanded to instruction override",
      evidence: "adversarial prompt-injection token detected in DOM snippet",
    });
    expect(parsed.divergence).toContain("instruction override");
    expect(parsed.evidence).toContain("prompt-injection");
  });
});

describe("LobstertrapDetectedIntentSchema — failure cases", () => {
  it("rejects undefined divergence (must be string | null, not missing)", () => {
    expect(() =>
      LobstertrapDetectedIntentSchema.parse({
        detected_intent: "classification",
        evidence: null,
      }),
    ).toThrow();
  });

  it("rejects empty detected_intent (.min(1))", () => {
    expect(() =>
      LobstertrapDetectedIntentSchema.parse({
        detected_intent: "",
        divergence: null,
        evidence: null,
      }),
    ).toThrow();
  });

  it("throws on parse(null)", () => {
    expect(() => LobstertrapDetectedIntentSchema.parse(null)).toThrow();
  });
});
