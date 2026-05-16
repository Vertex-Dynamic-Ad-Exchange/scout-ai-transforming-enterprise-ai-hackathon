import { describe, expect, it } from "vitest";
import {
  AgentVerdictSchema,
  ArbiterDecisionSchema,
  DisagreementSchema,
  VerifierKindSchema,
} from "@scout/shared";

const VALID_VERDICT = {
  verifier: "text" as const,
  decision: "ALLOW" as const,
  categories: [],
  detectedEntities: [],
  evidenceRefs: [],
  modelLatencyMs: 0,
  lobstertrapTraceId: "lt_abc123",
};

const validVerdict = (): typeof VALID_VERDICT =>
  JSON.parse(JSON.stringify(VALID_VERDICT)) as typeof VALID_VERDICT;

const VALID_DECISION = {
  decision: "ALLOW" as const,
  confidence: 0.5,
  consensusCategories: [],
  consensusEntities: [],
  disagreements: [],
  humanReviewRecommended: false,
  lobstertrapTraceId: "lt_arb_xyz",
};

const validDecision = (): typeof VALID_DECISION =>
  JSON.parse(JSON.stringify(VALID_DECISION)) as typeof VALID_DECISION;

describe("VerifierKindSchema", () => {
  it("accepts the three locked kinds", () => {
    expect(() => VerifierKindSchema.parse("text")).not.toThrow();
    expect(() => VerifierKindSchema.parse("image")).not.toThrow();
    expect(() => VerifierKindSchema.parse("video")).not.toThrow();
  });

  it("rejects 'audio'", () => {
    expect(() => VerifierKindSchema.parse("audio")).toThrow();
  });
});

describe("AgentVerdictSchema (happy)", () => {
  it("parses a valid verdict with non-null traceId", () => {
    const parsed = AgentVerdictSchema.parse(VALID_VERDICT);
    expect(parsed.verifier).toBe("text");
    expect(parsed.decision).toBe("ALLOW");
    expect(parsed.lobstertrapTraceId).toBe("lt_abc123");
  });

  it("accepts lobstertrapTraceId: null (degraded path; D10)", () => {
    const parsed = AgentVerdictSchema.parse({ ...validVerdict(), lobstertrapTraceId: null });
    expect(parsed.lobstertrapTraceId).toBeNull();
  });
});

describe("AgentVerdictSchema — edges (reject)", () => {
  it("rejects verifier: 'audio'", () => {
    expect(() => AgentVerdictSchema.parse({ ...validVerdict(), verifier: "audio" })).toThrow();
  });

  it("rejects decision: 'MAYBE'", () => {
    expect(() => AgentVerdictSchema.parse({ ...validVerdict(), decision: "MAYBE" })).toThrow();
  });

  it("rejects modelLatencyMs: -1", () => {
    expect(() => AgentVerdictSchema.parse({ ...validVerdict(), modelLatencyMs: -1 })).toThrow();
  });

  it("rejects modelLatencyMs: 1.5 (non-integer)", () => {
    expect(() => AgentVerdictSchema.parse({ ...validVerdict(), modelLatencyMs: 1.5 })).toThrow();
  });

  it("rejects categories[0].confidence: 1.1 (out of [0,1])", () => {
    expect(() =>
      AgentVerdictSchema.parse({
        ...validVerdict(),
        categories: [{ label: "x", confidence: 1.1 }],
      }),
    ).toThrow();
  });

  it("rejects lobstertrapTraceId: '' (empty ≠ null sentinel; D10)", () => {
    expect(() => AgentVerdictSchema.parse({ ...validVerdict(), lobstertrapTraceId: "" })).toThrow();
  });
});

describe("DisagreementSchema (D12)", () => {
  it("accepts a valid category disagreement with all three perVerifier keys", () => {
    expect(() =>
      DisagreementSchema.parse({
        kind: "category",
        label: "alcohol",
        perVerifier: { text: 0.9, image: 0.1, video: 0 },
      }),
    ).not.toThrow();
  });

  it("rejects kind: 'score'", () => {
    expect(() =>
      DisagreementSchema.parse({
        kind: "score",
        label: "alcohol",
        perVerifier: { text: 0.9, image: 0.1, video: 0 },
      }),
    ).toThrow();
  });

  it("rejects perVerifier missing 'video' key", () => {
    expect(() =>
      DisagreementSchema.parse({
        kind: "category",
        label: "alcohol",
        perVerifier: { text: 0.9, image: 0.1 },
      }),
    ).toThrow();
  });
});

describe("ArbiterDecisionSchema (happy)", () => {
  it("parses a valid decision with confidence 0.5", () => {
    const parsed = ArbiterDecisionSchema.parse(VALID_DECISION);
    expect(parsed.confidence).toBe(0.5);
    expect(parsed.humanReviewRecommended).toBe(false);
  });

  it("accepts lobstertrapTraceId: null (degraded path; D10)", () => {
    expect(() =>
      ArbiterDecisionSchema.parse({ ...validDecision(), lobstertrapTraceId: null }),
    ).not.toThrow();
  });
});

describe("ArbiterDecisionSchema — edges (reject)", () => {
  it("rejects confidence: 1.5 (D11)", () => {
    expect(() => ArbiterDecisionSchema.parse({ ...validDecision(), confidence: 1.5 })).toThrow();
  });

  it("rejects confidence: -0.1 (D11)", () => {
    expect(() => ArbiterDecisionSchema.parse({ ...validDecision(), confidence: -0.1 })).toThrow();
  });

  it("rejects disagreements[0].kind: 'score'", () => {
    expect(() =>
      ArbiterDecisionSchema.parse({
        ...validDecision(),
        disagreements: [
          {
            kind: "score",
            label: "x",
            perVerifier: { text: 0, image: 0, video: 0 },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects disagreements perVerifier missing 'video' (D12)", () => {
    expect(() =>
      ArbiterDecisionSchema.parse({
        ...validDecision(),
        disagreements: [
          {
            kind: "category",
            label: "x",
            perVerifier: { text: 0, image: 0 },
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects lobstertrapTraceId: '' (empty ≠ null sentinel; D10)", () => {
    expect(() =>
      ArbiterDecisionSchema.parse({ ...validDecision(), lobstertrapTraceId: "" }),
    ).toThrow();
  });
});
