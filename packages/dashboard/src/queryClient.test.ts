import { describe, expect, it } from "vitest";
import { queryClient } from "./queryClient.js";

// Pins the D10 constants PRP 05's VerdictTimeline depends on:
// staleTime=500 deduplicates the 1s polling cadence against re-renders;
// refetchOnMount/refetchOnWindowFocus = false prevents stampedes on
// tab-switch / pane remount. If a future PRP edits queryClient.ts and
// flips these knobs, this test fails before the timeline test gets a
// chance to be flaky in CI.
describe("queryClient", () => {
  const queries = queryClient.getDefaultOptions().queries;

  it("staleTime is 500ms (D10 — dedupes 1s polling cadence)", () => {
    expect(queries?.staleTime).toBe(500);
  });

  it("refetchOnMount is false (D10 — no remount stampede)", () => {
    expect(queries?.refetchOnMount).toBe(false);
  });

  it("refetchOnWindowFocus is false (D10 — visibility pause is per-query)", () => {
    expect(queries?.refetchOnWindowFocus).toBe(false);
  });
});
