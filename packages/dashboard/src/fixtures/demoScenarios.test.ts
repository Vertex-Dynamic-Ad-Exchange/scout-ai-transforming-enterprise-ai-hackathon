import { describe, expect, it } from "vitest";
import { AuditRowSchema } from "@scout/shared";
import { DEMO_SCENARIOS } from "./demoScenarios.js";

// PRP 07 Task 9: every demo row pins both the wire shape AND the
// on-stage content. If a schema field is added upstream, this test
// fails fast against the fixture file — not against a brittle render
// test where the failure is harder to diagnose.

describe("DEMO_SCENARIOS", () => {
  it("contains the five named scenarios across six rows (#5 spans cold + warm)", () => {
    const names = DEMO_SCENARIOS.map((s) => s.name);
    expect(names).toEqual([
      "Clean ALLOW",
      "Clean DENY",
      "Ambiguous Flash escalation",
      "HUMAN_REVIEW arbiter disagreement",
      "Cache-miss DENY (cold)",
      "Cache-miss ALLOW (warm)",
    ]);
  });

  it.each(DEMO_SCENARIOS.map((s, i) => [i, s.name, s] as const))(
    "scenario #%i (%s) parses against AuditRowSchema",
    (_i, _name, scenario) => {
      expect(() => AuditRowSchema.parse(scenario.row)).not.toThrow();
    },
  );

  it("showpiece row (HUMAN_REVIEW) carries a non-null divergence string for the Veea moment", () => {
    const showpiece = DEMO_SCENARIOS.find((s) => s.name === "HUMAN_REVIEW arbiter disagreement");
    expect(showpiece).toBeDefined();
    if (showpiece === undefined || showpiece.row.kind !== "verdict") return;
    expect(showpiece.row.verdict.decision).toBe("HUMAN_REVIEW");
    expect(showpiece.row.detectedIntent?.divergence).toMatch(/detected scope expanded/i);
  });

  it("cold cache-miss row has lobstertrapTraceId === null (no LLM call → no IntentDiff render)", () => {
    const cold = DEMO_SCENARIOS.find((s) => s.name === "Cache-miss DENY (cold)");
    expect(cold).toBeDefined();
    if (cold === undefined || cold.row.kind !== "verdict") return;
    expect(cold.row.verdict.lobstertrapTraceId).toBeNull();
    expect(cold.row.declaredIntent).toBeNull();
    expect(cold.row.detectedIntent).toBeNull();
  });
});
