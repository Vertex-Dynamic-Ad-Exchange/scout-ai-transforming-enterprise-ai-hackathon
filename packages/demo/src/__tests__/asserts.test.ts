import { AssertionError } from "node:assert/strict";
import { describe, expect, it } from "vitest";
import type { VerificationVerdict } from "@scout/shared";
import { assertVerdict } from "../asserts.js";
import type { Expectation } from "../types.js";

function verdict(over: Partial<VerificationVerdict> = {}): VerificationVerdict {
  return {
    decision: "ALLOW",
    reasons: [
      { kind: "profile_signal", ref: "News", detail: "" },
      { kind: "policy_rule", ref: "allow-news", detail: "" },
    ],
    profileId: "profile-1",
    policyVersion: "v1",
    latencyMs: 120,
    lobstertrapTraceId: null,
    ...over,
  };
}

describe("assertVerdict — Task 10 happy", () => {
  it("does not throw when every field aligns", () => {
    const exp: Expectation = {
      decision: "ALLOW",
      reasonKinds: ["profile_signal", "policy_rule"],
      latencyMsMax: 300,
      lobstertrapTraceIdNullable: true,
    };
    expect(() => assertVerdict(verdict(), exp)).not.toThrow();
  });
});

describe("assertVerdict — Task 10 edge (superset reasonKinds)", () => {
  it("expectation kinds need only be a subset of verdict kinds", () => {
    const exp: Expectation = {
      reasonKinds: ["profile_signal"],
      latencyMsMax: 300,
      lobstertrapTraceIdNullable: true,
    };
    expect(() => assertVerdict(verdict(), exp)).not.toThrow();
  });
});

describe("assertVerdict — Task 10 failure (latency over budget)", () => {
  it("throws AssertionError whose message contains both numbers", () => {
    const exp: Expectation = { latencyMsMax: 300, lobstertrapTraceIdNullable: true };
    const v = verdict({ latencyMs: 500 });
    try {
      assertVerdict(v, exp);
      expect.unreachable("expected AssertionError");
    } catch (err) {
      expect(err).toBeInstanceOf(AssertionError);
      const msg = (err as AssertionError).message;
      expect(msg).toContain("500");
      expect(msg).toContain("300");
    }
  });

  it("throws when lobstertrapTraceIdNullable: true but verdict carries a trace id", () => {
    const exp: Expectation = { latencyMsMax: 300, lobstertrapTraceIdNullable: true };
    const v = verdict({ lobstertrapTraceId: "lt-abc" });
    expect(() => assertVerdict(v, exp)).toThrow(AssertionError);
  });

  it("throws when lobstertrapTraceIdNullable: false but verdict has null trace id", () => {
    const exp: Expectation = { latencyMsMax: 300, lobstertrapTraceIdNullable: false };
    expect(() => assertVerdict(verdict({ lobstertrapTraceId: null }), exp)).toThrow(AssertionError);
  });
});
