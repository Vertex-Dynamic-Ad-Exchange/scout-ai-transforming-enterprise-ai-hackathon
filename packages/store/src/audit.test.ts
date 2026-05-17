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

describe("AuditStore — empty store edge", () => {
  it("query on an empty store returns { rows: [], nextCursor: null }", async () => {
    const { auditStore } = createStores();
    const result = await auditStore.query({ advertiserId: "A" });
    expect(result).toEqual({ rows: [], nextCursor: null });
  });

  it("get on an empty store returns null (does not throw)", async () => {
    const { auditStore } = createStores();
    await expect(auditStore.get("A", "no-such-id")).resolves.toBeNull();
  });
});

describe("AuditStore — pagination", () => {
  it("75 rows / limit 30 paginates to 30,30,15 with no dup, no miss, monotonic order", async () => {
    const { auditStore } = createStores();
    // 75 rows, varied ts, some same-ts to exercise the id tiebreak (D4).
    for (let i = 0; i < 75; i++) {
      // Bucket every 5 ids into the same minute to force same-ts groups.
      const minute = String(Math.floor(i / 5)).padStart(2, "0");
      const ts = `2026-05-15T12:${minute}:00.000Z`;
      const id = `row-${String(i).padStart(3, "0")}`;
      await auditStore.put(verdictRowFor("A", id, ts));
    }

    const page1 = await auditStore.query({ advertiserId: "A", limit: 30 });
    expect(page1.rows).toHaveLength(30);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await auditStore.query({
      advertiserId: "A",
      limit: 30,
      cursor: page1.nextCursor!,
    });
    expect(page2.rows).toHaveLength(30);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await auditStore.query({
      advertiserId: "A",
      limit: 30,
      cursor: page2.nextCursor!,
    });
    expect(page3.rows).toHaveLength(15);
    expect(page3.nextCursor).toBeNull();

    const all = [...page1.rows, ...page2.rows, ...page3.rows];
    expect(all).toHaveLength(75);
    expect(new Set(all.map((r) => r.id)).size).toBe(75);

    // Monotonic reverse-chrono — each row is strictly older than its predecessor.
    for (let i = 1; i < all.length; i++) {
      const prev = all[i - 1]!;
      const cur = all[i]!;
      const tsCmp = cur.ts < prev.ts;
      const idCmp = cur.ts === prev.ts && cur.id < prev.id;
      expect(tsCmp || idCmp).toBe(true);
    }
  });

  it("limit > 200 throws RangeError; default limit is 50", async () => {
    const { auditStore } = createStores();
    for (let i = 0; i < 60; i++) {
      const id = `row-${String(i).padStart(3, "0")}`;
      await auditStore.put(
        verdictRowFor("A", id, `2026-05-15T12:00:${String(i).padStart(2, "0")}.000Z`),
      );
    }

    await expect(auditStore.query({ advertiserId: "A", limit: 201 })).rejects.toThrow(
      RangeError,
    );

    // Default limit is 50 → 60 rows yields page1 of 50, nextCursor non-null.
    const defaultPage = await auditStore.query({ advertiserId: "A" });
    expect(defaultPage.rows).toHaveLength(50);
    expect(defaultPage.nextCursor).not.toBeNull();
  });
});
