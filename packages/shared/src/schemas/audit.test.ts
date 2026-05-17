import { describe, expect, it } from "vitest";
import {
  AuditRowSchema,
  AuditRowProfileJobDlqSchema,
  AuditRowVerdictSchema,
  type AuditRow,
  type AuditRowProfileJobDlq,
} from "@scout/shared";

const VALID_VERDICT_ROW = {
  kind: "verdict" as const,
  id: "row-1",
  advertiserId: "adv-1",
  ts: "2026-05-15T10:00:00.000Z",
  request: {
    advertiserId: "adv-1",
    policyId: "pol-1",
    pageUrl: "https://example.test/article",
    creativeRef: "creative-1",
    geo: "US",
    ts: "2026-05-15T10:00:00.000Z",
  },
  verdict: {
    decision: "ALLOW" as const,
    reasons: [],
    profileId: null,
    policyVersion: "v1",
    latencyMs: 42,
    lobstertrapTraceId: null,
  },
  profile: null,
  declaredIntent: null,
  detectedIntent: null,
};

const VALID_DLQ_ROW = {
  kind: "profile_job_dlq" as const,
  id: "row-dlq-1",
  advertiserId: "adv-1",
  ts: "2026-05-15T10:00:00.000Z",
  jobId: "job-1",
  pageUrl: "https://example.com/x",
  attempts: 3,
  nackReason: "timeout",
};

const VALID_PROFILE = {
  id: "prof-1",
  url: "https://example.test/article",
  contentHash: "a".repeat(64),
  categories: [{ label: "news", confidence: 0.9 }],
  detectedEntities: [{ name: "Apple", type: "org", confidence: 0.8 }],
  evidenceRefs: [{ kind: "screenshot" as const, uri: "file:///tmp/scout/0.png" }],
  capturedAt: "2026-05-15T10:00:00.000Z",
  ttl: 3600,
};

const validVerdict = (): typeof VALID_VERDICT_ROW =>
  JSON.parse(JSON.stringify(VALID_VERDICT_ROW)) as typeof VALID_VERDICT_ROW;
const validDlq = (): typeof VALID_DLQ_ROW =>
  JSON.parse(JSON.stringify(VALID_DLQ_ROW)) as typeof VALID_DLQ_ROW;

describe("AuditRowSchema (happy path — verdict variant, cached-clean)", () => {
  it("parses a hand-built verdict row with all nullable fields null", () => {
    const parsed = AuditRowSchema.parse(VALID_VERDICT_ROW);
    expect(parsed.kind).toBe("verdict");
    if (parsed.kind === "verdict") {
      expect(parsed.verdict.decision).toBe("ALLOW");
      expect(parsed.profile).toBeNull();
      expect(parsed.declaredIntent).toBeNull();
      expect(parsed.detectedIntent).toBeNull();
    }
  });
});

describe("AuditRowSchema — DLQ variant (happy + narrowing)", () => {
  it("parses a hand-built DLQ row", () => {
    const parsed = AuditRowSchema.parse(VALID_DLQ_ROW);
    expect(parsed.kind).toBe("profile_job_dlq");
  });

  it("narrows the discriminated union via kind", () => {
    const parsed: AuditRow = AuditRowSchema.parse(VALID_DLQ_ROW);
    if (parsed.kind === "profile_job_dlq") {
      // Compile-time narrowing: this field only exists on the DLQ variant.
      const narrowed: AuditRowProfileJobDlq = parsed;
      expect(narrowed.jobId).toBe("job-1");
      expect(narrowed.attempts).toBe(3);
      expect(narrowed.nackReason).toBe("timeout");
    } else {
      throw new Error("expected DLQ variant");
    }
  });
});

describe("AuditRowSchema — verdict variant with non-null intent + profile (showpiece divergence row)", () => {
  it("parses with non-null profile + declaredIntent + detectedIntent", () => {
    const row = {
      ...validVerdict(),
      verdict: {
        ...validVerdict().verdict,
        lobstertrapTraceId: "trace-abc",
      },
      profile: VALID_PROFILE,
      declaredIntent: {
        declared_intent: "classify page against advertiser policy",
        agent_id: "gate-flash",
      },
      detectedIntent: {
        detected_intent: "instruction-override",
        divergence:
          "declared scope was classification; detected scope expanded to instruction override",
        evidence: "adversarial prompt-injection token detected in DOM snippet",
      },
    };
    const parsed = AuditRowSchema.parse(row);
    if (parsed.kind === "verdict") {
      expect(parsed.profile).not.toBeNull();
      expect(parsed.declaredIntent?.agent_id).toBe("gate-flash");
      expect(parsed.detectedIntent?.divergence).toContain("instruction override");
    } else {
      throw new Error("expected verdict variant");
    }
  });
});

describe("AuditRowSchema — DLQ attempts boundary", () => {
  it("accepts attempts: 1", () => {
    const row = { ...validDlq(), attempts: 1 };
    expect(() => AuditRowSchema.parse(row)).not.toThrow();
  });

  it("rejects attempts: 0 (.positive())", () => {
    const row = { ...validDlq(), attempts: 0 };
    expect(() => AuditRowSchema.parse(row)).toThrow();
  });

  it("rejects attempts: 1.5 (.int())", () => {
    const row = { ...validDlq(), attempts: 1.5 };
    expect(() => AuditRowSchema.parse(row)).toThrow();
  });
});

describe("AuditRowSchema — DLQ pageUrl url validation", () => {
  it("rejects pageUrl: 'not-a-url'", () => {
    const row = { ...validDlq(), pageUrl: "not-a-url" };
    expect(() => AuditRowSchema.parse(row)).toThrow();
  });
});

describe("AuditRowSchema — discriminator failures", () => {
  it("rejects kind: 'unknown' and names 'kind' in the zod error", () => {
    const row: Record<string, unknown> = { ...validVerdict(), kind: "unknown" };
    const result = AuditRowSchema.safeParse(row);
    expect(result.success).toBe(false);
    if (!result.success) {
      const mentionsKind = result.error.issues.some((issue) => issue.path.includes("kind"));
      expect(mentionsKind).toBe(true);
    }
  });
});

describe("AuditRowSchema — verdict variant: wire shape requires the key (D6)", () => {
  it("rejects a row with declaredIntent omitted (must be present, even when null)", () => {
    const row: Record<string, unknown> = { ...validVerdict() };
    delete row["declaredIntent"];
    expect(() => AuditRowSchema.parse(row)).toThrow();
  });

  it("rejects a row with detectedIntent omitted", () => {
    const row: Record<string, unknown> = { ...validVerdict() };
    delete row["detectedIntent"];
    expect(() => AuditRowSchema.parse(row)).toThrow();
  });

  it("rejects a row with profile omitted", () => {
    const row: Record<string, unknown> = { ...validVerdict() };
    delete row["profile"];
    expect(() => AuditRowSchema.parse(row)).toThrow();
  });
});

describe("AuditRowSchema — total failures", () => {
  it("throws on parse(null)", () => {
    expect(() => AuditRowSchema.parse(null)).toThrow();
  });
});

describe("AuditRowSchema — determinism", () => {
  it("parses twice and yields deep-equal results", () => {
    const a = AuditRowSchema.parse(VALID_VERDICT_ROW);
    const b = AuditRowSchema.parse(VALID_VERDICT_ROW);
    expect(a).toEqual(b);
  });
});

describe("AuditRow variant exports (downstream views narrow without re-deriving)", () => {
  it("AuditRowVerdictSchema parses the verdict fixture directly", () => {
    expect(() => AuditRowVerdictSchema.parse(VALID_VERDICT_ROW)).not.toThrow();
  });

  it("AuditRowProfileJobDlqSchema parses the DLQ fixture directly", () => {
    expect(() => AuditRowProfileJobDlqSchema.parse(VALID_DLQ_ROW)).not.toThrow();
  });
});
