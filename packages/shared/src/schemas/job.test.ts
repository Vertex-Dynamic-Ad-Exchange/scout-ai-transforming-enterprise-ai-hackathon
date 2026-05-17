import { describe, expect, it } from "vitest";
import { DegradationHintSchema, ProfileJobSchema } from "@scout/shared";

const VALID_JOB = {
  id: "01J9F1Y3VR6D5JEKBM9YE8V9KT",
  pageUrl: "https://example.test/article",
  advertiserId: "adv-1",
  policyId: "pol-1",
  geo: "US",
  enqueuedAt: "2026-05-16T00:00:00.000Z",
  attempt: 1,
  degradationHint: "none" as const,
};

const valid = (): typeof VALID_JOB => JSON.parse(JSON.stringify(VALID_JOB)) as typeof VALID_JOB;

describe("ProfileJobSchema (happy path)", () => {
  it("parses a hand-built valid ProfileJob literal", () => {
    const parsed = ProfileJobSchema.parse(VALID_JOB);
    expect(parsed.id).toBe(VALID_JOB.id);
    expect(parsed.pageUrl).toBe(VALID_JOB.pageUrl);
    expect(parsed.geo).toBe("US");
    expect(parsed.attempt).toBe(1);
    expect(parsed.degradationHint).toBe("none");
  });
});

describe("ProfileJobSchema — geo alpha-2 (D4)", () => {
  it("accepts 'US'", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), geo: "US" })).not.toThrow();
  });

  it("rejects lowercase 'us'", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), geo: "us" })).toThrow();
  });

  it("rejects alpha-3 'USA'", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), geo: "USA" })).toThrow();
  });
});

describe("ProfileJobSchema — attempt int().min(1) (D2)", () => {
  it("accepts 1", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), attempt: 1 })).not.toThrow();
  });

  it("rejects 0", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), attempt: 0 })).toThrow();
  });

  it("rejects -1", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), attempt: -1 })).toThrow();
  });

  it("rejects 1.5 (non-integer)", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), attempt: 1.5 })).toThrow();
  });
});

describe("ProfileJobSchema — degradationHint enum (D3)", () => {
  it("accepts 'none'", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), degradationHint: "none" })).not.toThrow();
  });

  it("accepts 'drop_video'", () => {
    expect(() =>
      ProfileJobSchema.parse({ ...valid(), degradationHint: "drop_video" }),
    ).not.toThrow();
  });

  it("accepts 'collapse_text_image'", () => {
    expect(() =>
      ProfileJobSchema.parse({ ...valid(), degradationHint: "collapse_text_image" }),
    ).not.toThrow();
  });

  it("rejects uppercase 'NONE'", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), degradationHint: "NONE" })).toThrow();
  });

  it("rejects unknown 'other'", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), degradationHint: "other" })).toThrow();
  });
});

describe("ProfileJobSchema — id (D5)", () => {
  it("rejects empty string", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), id: "" })).toThrow();
  });

  it("accepts a ULID-shaped value (min(1) only)", () => {
    expect(() =>
      ProfileJobSchema.parse({ ...valid(), id: "01J9F1Y3VR6D5JEKBM9YE8V9KT" }),
    ).not.toThrow();
  });
});

describe("ProfileJobSchema — pageUrl url() (D1)", () => {
  it("accepts a valid https URL", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), pageUrl: "https://x.test/" })).not.toThrow();
  });

  it("rejects 'not-a-url'", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), pageUrl: "not-a-url" })).toThrow();
  });
});

describe("ProfileJobSchema — enqueuedAt datetime", () => {
  it("accepts ISO8601 with Z", () => {
    expect(() =>
      ProfileJobSchema.parse({ ...valid(), enqueuedAt: "2026-05-16T00:00:00Z" }),
    ).not.toThrow();
  });

  it("rejects date-only", () => {
    expect(() => ProfileJobSchema.parse({ ...valid(), enqueuedAt: "2026-05-16" })).toThrow();
  });
});

describe("ProfileJobSchema — total failures", () => {
  it("throws on parse(null)", () => {
    expect(() => ProfileJobSchema.parse(null)).toThrow();
  });

  it("throws on parse({})", () => {
    expect(() => ProfileJobSchema.parse({})).toThrow();
  });
});

describe("DegradationHintSchema", () => {
  it("exports the three locked values (D3)", () => {
    expect(() => DegradationHintSchema.parse("none")).not.toThrow();
    expect(() => DegradationHintSchema.parse("drop_video")).not.toThrow();
    expect(() => DegradationHintSchema.parse("collapse_text_image")).not.toThrow();
  });
});
