import { describe, expect, it } from "vitest";
import { ScenarioSchema, loadScenario } from "@scout/demo";

const minimalFixture = () => ({
  formatVersion: "1.0" as const,
  name: "test",
  description: "",
  seeds: { profiles: [], policies: [] },
  bids: [
    {
      delayMs: 0,
      request: {
        advertiserId: "a",
        policyId: "p",
        pageUrl: "https://example.com/",
        creativeRef: "c",
        geo: "US",
        ts: "2026-05-17T00:00:00Z",
      },
    },
  ],
  expectations: [
    { latencyMsMax: 300, lobstertrapTraceIdNullable: true },
  ],
});

describe("ScenarioSchema (happy)", () => {
  it("loadScenario parses a minimal valid fixture", () => {
    const scenario = loadScenario(minimalFixture());
    expect(scenario.name).toBe("test");
    expect(scenario.bids).toHaveLength(1);
    expect(scenario.expectations).toHaveLength(1);
    expect(scenario.formatVersion).toBe("1.0");
  });
});

describe("ScenarioSchema — edge matrix", () => {
  describe("formatVersion (D2)", () => {
    it("rejects '0.9'", () => {
      const f = minimalFixture() as Record<string, unknown>;
      f.formatVersion = "0.9";
      expect(() => loadScenario(f)).toThrow();
    });

    it("rejects '1.1'", () => {
      const f = minimalFixture() as Record<string, unknown>;
      f.formatVersion = "1.1";
      expect(() => loadScenario(f)).toThrow();
    });

    it("rejects absent formatVersion", () => {
      const f = minimalFixture() as Record<string, unknown>;
      delete f.formatVersion;
      expect(() => loadScenario(f)).toThrow();
    });

    it("accepts '1.0'", () => {
      expect(() => loadScenario(minimalFixture())).not.toThrow();
    });
  });

  describe("delayMs (D5)", () => {
    it("rejects -1", () => {
      const f = minimalFixture();
      (f.bids[0] as { delayMs: number }).delayMs = -1;
      expect(() => loadScenario(f)).toThrow();
    });

    it("rejects 1.5 (non-integer)", () => {
      const f = minimalFixture();
      (f.bids[0] as { delayMs: number }).delayMs = 1.5;
      expect(() => loadScenario(f)).toThrow();
    });

    it("rejects non-number", () => {
      const f = minimalFixture();
      (f.bids[0] as unknown as { delayMs: unknown }).delayMs = "0";
      expect(() => loadScenario(f)).toThrow();
    });

    it("accepts 0", () => {
      expect(() => loadScenario(minimalFixture())).not.toThrow();
    });
  });

  describe("latencyMsMax (D7)", () => {
    it("rejects 0", () => {
      const f = minimalFixture();
      (f.expectations[0] as { latencyMsMax: number }).latencyMsMax = 0;
      expect(() => loadScenario(f)).toThrow();
    });

    it("rejects -1", () => {
      const f = minimalFixture();
      (f.expectations[0] as { latencyMsMax: number }).latencyMsMax = -1;
      expect(() => loadScenario(f)).toThrow();
    });

    it("rejects 1.5 (non-integer)", () => {
      const f = minimalFixture();
      (f.expectations[0] as { latencyMsMax: number }).latencyMsMax = 1.5;
      expect(() => loadScenario(f)).toThrow();
    });

    it("accepts 1", () => {
      const f = minimalFixture();
      (f.expectations[0] as { latencyMsMax: number }).latencyMsMax = 1;
      expect(() => loadScenario(f)).not.toThrow();
    });
  });

  describe("lobstertrapTraceIdNullable (D8)", () => {
    it("accepts true", () => {
      const f = minimalFixture();
      (f.expectations[0] as { lobstertrapTraceIdNullable: boolean }).lobstertrapTraceIdNullable = true;
      expect(() => loadScenario(f)).not.toThrow();
    });

    it("accepts false", () => {
      const f = minimalFixture();
      (f.expectations[0] as { lobstertrapTraceIdNullable: boolean }).lobstertrapTraceIdNullable = false;
      expect(() => loadScenario(f)).not.toThrow();
    });

    it("rejects absent", () => {
      const f = minimalFixture();
      delete (f.expectations[0] as { lobstertrapTraceIdNullable?: boolean }).lobstertrapTraceIdNullable;
      expect(() => loadScenario(f)).toThrow();
    });

    it("rejects 'yes' (string)", () => {
      const f = minimalFixture();
      (f.expectations[0] as unknown as { lobstertrapTraceIdNullable: unknown }).lobstertrapTraceIdNullable = "yes";
      expect(() => loadScenario(f)).toThrow();
    });
  });

  describe("reasonKinds (D9)", () => {
    it("accepts ['profile_signal']", () => {
      const f = minimalFixture();
      (f.expectations[0] as { reasonKinds?: string[] }).reasonKinds = ["profile_signal"];
      expect(() => loadScenario(f)).not.toThrow();
    });

    it("rejects ['bogus']", () => {
      const f = minimalFixture();
      (f.expectations[0] as { reasonKinds?: string[] }).reasonKinds = ["bogus"];
      expect(() => loadScenario(f)).toThrow();
    });
  });

  describe("bids.length !== expectations.length (D6)", () => {
    it("refine fires with path ['expectations']", () => {
      const f = minimalFixture();
      f.expectations = [];
      try {
        loadScenario(f);
        expect.unreachable("should have thrown");
      } catch (e) {
        const issues = (e as { issues?: Array<{ path: Array<string | number> }> }).issues;
        expect(issues).toBeDefined();
        expect(issues?.some((i) => i.path.includes("expectations"))).toBe(true);
      }
    });

    it("happy when lengths match (length 2)", () => {
      const f = minimalFixture();
      const cloned = JSON.parse(JSON.stringify(f)) as typeof f;
      f.bids.push(cloned.bids[0]!);
      f.expectations.push(cloned.expectations[0]!);
      expect(() => loadScenario(f)).not.toThrow();
    });
  });

  describe(".strict() top-level (Scenario)", () => {
    it("rejects unknown top-level key", () => {
      const f = minimalFixture() as Record<string, unknown>;
      f.extra = "nope";
      expect(() => loadScenario(f)).toThrow();
    });
  });

  describe(".strict() on nested schemas", () => {
    it("rejects unknown key in seeds", () => {
      const f = minimalFixture();
      (f.seeds as Record<string, unknown>).extra = "nope";
      expect(() => loadScenario(f)).toThrow();
    });

    it("rejects unknown key in bids[]", () => {
      const f = minimalFixture();
      (f.bids[0] as Record<string, unknown>).extra = "nope";
      expect(() => loadScenario(f)).toThrow();
    });

    it("rejects unknown key in expectations[]", () => {
      const f = minimalFixture();
      (f.expectations[0] as Record<string, unknown>).extra = "nope";
      expect(() => loadScenario(f)).toThrow();
    });
  });

  describe("ScenarioSchema export shape", () => {
    it("is a callable zod schema", () => {
      expect(typeof ScenarioSchema.parse).toBe("function");
    });
  });
});

describe("loadScenario — deep-parse", () => {
  it("throws on bid.request missing creativeRef; path includes 'creativeRef'", () => {
    const f = minimalFixture();
    delete (f.bids[0]!.request as { creativeRef?: string }).creativeRef;
    try {
      loadScenario(f);
      expect.unreachable("should have thrown");
    } catch (e) {
      const issues = (e as { issues?: Array<{ path: Array<string | number> }> }).issues;
      expect(issues).toBeDefined();
      expect(issues?.some((i) => i.path.includes("creativeRef"))).toBe(true);
    }
  });

  it("throws on expectations[].decision: 'MAYBE'", () => {
    const f = minimalFixture();
    (f.expectations[0] as { decision?: string }).decision = "MAYBE";
    expect(() => loadScenario(f)).toThrow();
  });

  it("throws on loadScenario(null)", () => {
    expect(() => loadScenario(null)).toThrow();
  });

  it("throws on loadScenario({})", () => {
    expect(() => loadScenario({})).toThrow();
  });

  it("throws on loadScenario('not-an-object')", () => {
    expect(() => loadScenario("not-an-object")).toThrow();
  });

  it("happy round-trip preserves bids[0].request.advertiserId (no mutation)", () => {
    const f = minimalFixture();
    const originalAdvertiserId = (f.bids[0]!.request as { advertiserId: string }).advertiserId;
    const scenario = loadScenario(f);
    expect((scenario.bids[0]!.request as { advertiserId: string }).advertiserId).toBe(
      originalAdvertiserId,
    );
    expect((f.bids[0]!.request as { advertiserId: string }).advertiserId).toBe(
      originalAdvertiserId,
    );
  });
});
