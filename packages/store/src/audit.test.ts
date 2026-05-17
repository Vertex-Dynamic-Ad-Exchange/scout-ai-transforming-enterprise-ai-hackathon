import { describe, it, expect } from "vitest";
import type {
  AuditRow,
  AuditRowProfileJobDlq,
  AuditRowVerdict,
  Decision,
} from "@scout/shared";
import { createStores } from "./index.js";

function makeVerdictRow(overrides: Partial<AuditRowVerdict> = {}): AuditRowVerdict {
  const base: AuditRowVerdict = {
    kind: "verdict",
    id: "row-A-1",
    advertiserId: "A",
    ts: "2026-05-15T12:00:00.000Z",
    request: {
      advertiserId: "A",
      policyId: "pol1",
      pageUrl: "https://example.com/a",
      creativeRef: "cr-1",
      geo: "US",
      ts: "2026-05-15T12:00:00.000Z",
    },
    verdict: {
      decision: "ALLOW",
      reasons: [],
      profileId: null,
      policyVersion: "v1",
      latencyMs: 12,
      lobstertrapTraceId: null,
    },
    profile: null,
    declaredIntent: null,
    detectedIntent: null,
  };
  const merged: AuditRowVerdict = { ...base, ...overrides };
  if (overrides.verdict !== undefined) {
    merged.verdict = { ...base.verdict, ...overrides.verdict };
  }
  if (overrides.request !== undefined) {
    merged.request = { ...base.request, ...overrides.request };
  }
  return merged;
}

function verdictRowFor(
  advertiserId: string,
  id: string,
  ts: string,
  decision: Decision = "ALLOW",
  pageUrl = "https://example.com/a",
): AuditRowVerdict {
  return makeVerdictRow({
    id,
    advertiserId,
    ts,
    verdict: { decision } as AuditRowVerdict["verdict"],
    request: { advertiserId, pageUrl } as AuditRowVerdict["request"],
  });
}

function dlqRowFor(
  advertiserId: string,
  id: string,
  ts: string,
  pageUrl = "https://example.com/dlq",
): AuditRowProfileJobDlq {
  return {
    kind: "profile_job_dlq",
    id,
    advertiserId,
    ts,
    jobId: `${id}-job`,
    pageUrl,
    attempts: 3,
    nackReason: "timeout",
  };
}

describe("AuditStore — happy round-trip", () => {
  it("put → query → get returns the same row", async () => {
    const { auditStore } = createStores();
    const row: AuditRow = makeVerdictRow();
    await auditStore.put(row);

    const queryResult = await auditStore.query({ advertiserId: "A" });
    expect(queryResult.rows).toEqual([row]);
    expect(queryResult.nextCursor).toBeNull();

    const fetched = await auditStore.get("A", row.id);
    expect(fetched).toEqual(row);
  });
});

describe("AuditStore — filter axes", () => {
  it("decision: 'DENY' returns only the DENY verdict row", async () => {
    const { auditStore } = createStores();
    await auditStore.put(verdictRowFor("A", "r-allow", "2026-05-15T12:00:00.000Z", "ALLOW"));
    await auditStore.put(verdictRowFor("A", "r-deny", "2026-05-15T12:01:00.000Z", "DENY"));
    await auditStore.put(
      verdictRowFor("A", "r-hr", "2026-05-15T12:02:00.000Z", "HUMAN_REVIEW"),
    );

    const result = await auditStore.query({ advertiserId: "A", decision: "DENY" });
    expect(result.rows.map((r) => r.id)).toEqual(["r-deny"]);
  });

  it("pageUrl exact-match returns the single matching row", async () => {
    const { auditStore } = createStores();
    await auditStore.put(
      verdictRowFor("A", "r-1", "2026-05-15T12:00:00.000Z", "ALLOW", "https://example.com/x"),
    );
    await auditStore.put(
      verdictRowFor("A", "r-2", "2026-05-15T12:01:00.000Z", "ALLOW", "https://example.com/y"),
    );
    await auditStore.put(
      verdictRowFor("A", "r-3", "2026-05-15T12:02:00.000Z", "ALLOW", "https://example.com/z"),
    );

    const result = await auditStore.query({
      advertiserId: "A",
      pageUrl: "https://example.com/y",
    });
    expect(result.rows.map((r) => r.id)).toEqual(["r-2"]);
  });

  it("kind: 'profile_job_dlq' returns only DLQ rows; unset returns both variants", async () => {
    const { auditStore } = createStores();
    const v = verdictRowFor("A", "r-v", "2026-05-15T12:00:00.000Z");
    const d = dlqRowFor("A", "r-d", "2026-05-15T12:01:00.000Z");
    await auditStore.put(v);
    await auditStore.put(d);

    const both = await auditStore.query({ advertiserId: "A" });
    expect(both.rows.map((r) => r.id).sort()).toEqual(["r-d", "r-v"]);

    const dlqOnly = await auditStore.query({
      advertiserId: "A",
      kind: "profile_job_dlq",
    });
    expect(dlqOnly.rows.map((r) => r.id)).toEqual(["r-d"]);
  });

  it("since/until window returns only rows inside [since, until]", async () => {
    const { auditStore } = createStores();
    await auditStore.put(verdictRowFor("A", "r-early", "2026-05-01T00:00:00.000Z"));
    await auditStore.put(verdictRowFor("A", "r-mid", "2026-05-15T00:00:00.000Z"));
    await auditStore.put(verdictRowFor("A", "r-late", "2026-05-30T00:00:00.000Z"));

    const result = await auditStore.query({
      advertiserId: "A",
      since: "2026-05-10T00:00:00.000Z",
      until: "2026-05-20T00:00:00.000Z",
    });
    expect(result.rows.map((r) => r.id)).toEqual(["r-mid"]);
  });
});
