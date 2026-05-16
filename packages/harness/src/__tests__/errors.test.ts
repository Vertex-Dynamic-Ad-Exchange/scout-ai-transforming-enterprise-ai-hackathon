import { describe, expect, it, test } from "vitest";
import { HarnessError, HarnessException, type HarnessErrorCode } from "@scout/shared";
import { classifySdkError } from "../errors.js";

const cases: ReadonlyArray<{ name: string; input: unknown; expected: HarnessErrorCode }> = [
  {
    name: "rate-limit (429) → UPSTREAM_DOWN",
    input: { status: 429, name: "RateLimitError", message: "slow down" },
    expected: HarnessError.UPSTREAM_DOWN,
  },
  {
    name: "session-timeout-limit (403) → TIMEOUT",
    input: { status: 403, name: "SessionTimeoutLimitExceededError" },
    expected: HarnessError.TIMEOUT,
  },
  {
    name: "validation (422) → UPSTREAM_DOWN",
    input: { status: 422, name: "ValidationError" },
    expected: HarnessError.UPSTREAM_DOWN,
  },
  {
    name: "profile-not-found (404) → UPSTREAM_DOWN",
    input: { status: 404, name: "ProfileNotFoundError" },
    expected: HarnessError.UPSTREAM_DOWN,
  },
  {
    name: "raw Error('network unreachable') → UPSTREAM_DOWN",
    input: new Error("network unreachable"),
    expected: HarnessError.UPSTREAM_DOWN,
  },
  {
    name: "Error with name='TimeoutError' (Playwright) → TIMEOUT",
    input: Object.assign(new Error("nav timeout"), { name: "TimeoutError" }),
    expected: HarnessError.TIMEOUT,
  },
];

describe("classifySdkError — duck-typed matrix", () => {
  test.each(cases)("$name", ({ input, expected }) => {
    expect(classifySdkError(input)).toBe(expected);
  });

  it("echoes the code from a HarnessException instance", () => {
    const ex = new HarnessException(HarnessError.TIMEOUT, "x");
    expect(classifySdkError(ex)).toBe(HarnessError.TIMEOUT);
  });

  // Label each non-Error case so vitest never tries to format the raw value
  // (a raw Symbol would throw "Cannot convert a Symbol value to a string"
  // before the test body runs).
  const nonErrorCases: ReadonlyArray<{ label: string; value: unknown }> = [
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "number 42", value: 42 },
    { label: "string 'boom'", value: "boom" },
    { label: "boolean true", value: true },
    { label: "Symbol", value: Symbol("x") },
  ];
  it.each(nonErrorCases)("non-Error $label → UPSTREAM_DOWN", ({ value }) => {
    expect(classifySdkError(value)).toBe(HarnessError.UPSTREAM_DOWN);
  });
});
