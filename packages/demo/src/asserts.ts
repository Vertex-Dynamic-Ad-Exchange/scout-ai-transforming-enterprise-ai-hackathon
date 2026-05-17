import { AssertionError } from "node:assert/strict";
import type { VerificationVerdict } from "@scout/shared";
import type { Expectation } from "./types.js";

/** Throws AssertionError on first mismatch. PRP-B Task 10:
 *  - decision: strict equality when expectation.decision is set
 *  - reasonKinds: superset (expectation kinds ⊆ verdict kinds)
 *  - latencyMs: must be ≤ latencyMsMax
 *  - lobstertrapTraceIdNullable: true → must be null; false → non-empty string
 */
export function assertVerdict(verdict: VerificationVerdict, expectation: Expectation): void {
  if (expectation.decision !== undefined && verdict.decision !== expectation.decision) {
    throw new AssertionError({
      message: `decision mismatch: expected ${expectation.decision}, got ${verdict.decision}`,
      actual: verdict.decision,
      expected: expectation.decision,
    });
  }
  if (expectation.reasonKinds !== undefined) {
    const actualKinds = new Set(verdict.reasons.map((r) => r.kind));
    for (const kind of expectation.reasonKinds) {
      if (!actualKinds.has(kind)) {
        throw new AssertionError({
          message: `reasonKinds superset miss: expected kind "${kind}" not present in verdict kinds [${[...actualKinds].join(",")}]`,
          actual: [...actualKinds],
          expected: expectation.reasonKinds,
        });
      }
    }
  }
  if (verdict.latencyMs > expectation.latencyMsMax) {
    throw new AssertionError({
      message: `latencyMs exceeds budget: ${verdict.latencyMs} > ${expectation.latencyMsMax}`,
      actual: verdict.latencyMs,
      expected: expectation.latencyMsMax,
    });
  }
  if (expectation.lobstertrapTraceIdNullable) {
    if (verdict.lobstertrapTraceId !== null) {
      throw new AssertionError({
        message: `expected lobstertrapTraceId === null, got ${JSON.stringify(verdict.lobstertrapTraceId)}`,
        actual: verdict.lobstertrapTraceId,
        expected: null,
      });
    }
  } else {
    if (typeof verdict.lobstertrapTraceId !== "string" || verdict.lobstertrapTraceId.length === 0) {
      throw new AssertionError({
        message: `expected non-empty string lobstertrapTraceId, got ${JSON.stringify(verdict.lobstertrapTraceId)}`,
        actual: verdict.lobstertrapTraceId,
        expected: "<non-empty string>",
      });
    }
  }
}
