import { describe, expect, it } from "vitest";
import type { AuditRow } from "@scout/shared";
import { MockAuditClient } from "./MockAuditClient.js";
import { DEMO_SCENARIOS } from "../fixtures/demoScenarios.js";

// PRP 07 Task 10 (D10): MockAuditClient is the reusable test-time
// fixture seam for PRP 04's `App.demo.test.tsx` and any later visual
// smoke tests in PRPs 05/06. It is intentionally NOT exported from the
// runtime barrel (`src/index.ts`) — the bundle-grep test in
// `src/__bundle__/no-secrets.test.ts` pins this by adding the literal
// `MockAuditClient` to the forbidden-string list (the only forbidden
// list crossing into client bundles for non-secret reasons).

function rowIds(rows: AuditRow[]): string[] {
  return rows.map((r) => r.id);
}

describe("MockAuditClient", () => {
  it("happy — query() returns all seeded rows reverse-chronological by ts (default seed = DEMO_SCENARIOS)", () => {
    const client = new MockAuditClient();
    const { rows, nextCursor } = client.query();
    // Demo scenarios are authored in chronological order, so reverse-
    // chronological is the inverse of the source order.
    const expected = [...DEMO_SCENARIOS].map((s) => s.row.id).reverse();
    expect(rowIds(rows)).toEqual(expected);
    expect(nextCursor).toBeNull();
  });

  it("happy — get(id) returns the single matching row", () => {
    const client = new MockAuditClient();
    const row = client.get("demo-row-4");
    expect(row).not.toBeNull();
    expect(row?.id).toBe("demo-row-4");
    if (row?.kind === "verdict") {
      expect(row.verdict.decision).toBe("HUMAN_REVIEW");
    }
  });

  it("edge — query({ kind: 'profile_job_dlq' }) returns [] (no DLQ rows in DEMO_SCENARIOS)", () => {
    const client = new MockAuditClient();
    const { rows } = client.query({ kind: "profile_job_dlq" });
    expect(rows).toEqual([]);
  });

  it("edge — query({ kind: 'verdict' }) returns every verdict row (none filtered out)", () => {
    const client = new MockAuditClient();
    const { rows } = client.query({ kind: "verdict" });
    expect(rows).toHaveLength(DEMO_SCENARIOS.length);
    for (const r of rows) expect(r.kind).toBe("verdict");
  });

  it("failure — get('nonexistent') returns null and does NOT throw (enumeration-safe; matches backend 404 contract)", () => {
    const client = new MockAuditClient();
    expect(() => client.get("nonexistent")).not.toThrow();
    expect(client.get("nonexistent")).toBeNull();
  });

  it("custom seed — caller-supplied rows are used in place of DEMO_SCENARIOS, still reverse-chronological", () => {
    const seed: AuditRow[] = [
      {
        kind: "profile_job_dlq",
        id: "dlq-1",
        advertiserId: "demo-advertiser",
        ts: "2026-05-17T11:00:00.000Z",
        jobId: "job-1",
        pageUrl: "https://example.com/x",
        attempts: 3,
        nackReason: "fetch_timeout",
      },
      {
        kind: "profile_job_dlq",
        id: "dlq-2",
        advertiserId: "demo-advertiser",
        ts: "2026-05-17T13:00:00.000Z",
        jobId: "job-2",
        pageUrl: "https://example.com/y",
        attempts: 5,
        nackReason: "snapshot_failed",
      },
    ];
    const client = new MockAuditClient(seed);
    expect(rowIds(client.query().rows)).toEqual(["dlq-2", "dlq-1"]);
    expect(client.query({ kind: "verdict" }).rows).toEqual([]);
    expect(client.query({ kind: "profile_job_dlq" }).rows).toHaveLength(2);
  });
});
