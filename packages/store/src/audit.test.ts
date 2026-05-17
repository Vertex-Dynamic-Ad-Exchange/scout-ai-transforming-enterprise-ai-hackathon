import { describe, it, expect } from "vitest";
import type { AuditRow } from "@scout/shared";
import { createStores } from "./index.js";
import { dlqRowFor, makeVerdictRow, verdictRowFor } from "./audit.test-helpers.js";

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

describe("AuditStore — tenant isolation (LOAD-BEARING)", () => {
  it("query for A returns only A's rows; query for B returns only B's", async () => {
    const { auditStore } = createStores();
    const aRows: AuditRow[] = [
      verdictRowFor("A", "a-1", "2026-05-15T12:00:00.000Z"),
      verdictRowFor("A", "a-2", "2026-05-15T12:01:00.000Z"),
      verdictRowFor("A", "a-3", "2026-05-15T12:02:00.000Z", "DENY"),
      dlqRowFor("A", "a-4", "2026-05-15T12:03:00.000Z"),
      verdictRowFor("A", "a-5", "2026-05-15T12:04:00.000Z"),
    ];
    const bRows: AuditRow[] = [
      verdictRowFor("B", "b-1", "2026-05-15T12:00:30.000Z"),
      verdictRowFor("B", "b-2", "2026-05-15T12:01:30.000Z", "DENY"),
      dlqRowFor("B", "b-3", "2026-05-15T12:02:30.000Z"),
      verdictRowFor("B", "b-4", "2026-05-15T12:03:30.000Z"),
      verdictRowFor("B", "b-5", "2026-05-15T12:04:30.000Z", "HUMAN_REVIEW"),
    ];
    for (const r of [...aRows, ...bRows]) await auditStore.put(r);

    const aResult = await auditStore.query({
      advertiserId: "A",
      since: "1970-01-01T00:00:00.000Z",
    });
    expect(aResult.rows.map((r) => r.id).sort()).toEqual(
      aRows.map((r) => r.id).sort(),
    );
    expect(aResult.rows.every((r) => r.advertiserId === "A")).toBe(true);

    const bResult = await auditStore.query({
      advertiserId: "B",
      since: "1970-01-01T00:00:00.000Z",
    });
    expect(bResult.rows.map((r) => r.id).sort()).toEqual(
      bRows.map((r) => r.id).sort(),
    );
    expect(bResult.rows.every((r) => r.advertiserId === "B")).toBe(true);
  });

  it("get('A', <B's id>) returns null (NOT throws) — 404-not-403, symmetric for B", async () => {
    const { auditStore } = createStores();
    const aRows = [
      verdictRowFor("A", "a-1", "2026-05-15T12:00:00.000Z"),
      verdictRowFor("A", "a-2", "2026-05-15T12:01:00.000Z"),
    ];
    const bRows = [
      verdictRowFor("B", "b-1", "2026-05-15T12:02:00.000Z"),
      dlqRowFor("B", "b-2", "2026-05-15T12:03:00.000Z"),
    ];
    for (const r of [...aRows, ...bRows]) await auditStore.put(r);

    for (const b of bRows) {
      await expect(auditStore.get("A", b.id)).resolves.toBeNull();
    }
    for (const a of aRows) {
      await expect(auditStore.get("B", a.id)).resolves.toBeNull();
    }

    // sanity: each tenant CAN see its own rows
    for (const a of aRows) {
      const own = await auditStore.get("A", a.id);
      expect(own?.id).toBe(a.id);
    }
    for (const b of bRows) {
      const own = await auditStore.get("B", b.id);
      expect(own?.id).toBe(b.id);
    }
  });

  it("AuditQueryFilter requires advertiserId at the type level (D5)", () => {
    const { auditStore } = createStores();
    // If this line ever stops erroring, the filter type lost its
    // tenant-scope requirement and pagination could leak across tenants.
    // @ts-expect-error advertiserId is required by AuditQueryFilter
    void auditStore.query({ since: "1970-01-01T00:00:00.000Z" });
  });
});

describe("AuditStore — cursor opacity (LOAD-BEARING)", () => {
  async function seed(advertiserId: string, n: number, auditStore: ReturnType<typeof createStores>["auditStore"]): Promise<void> {
    for (let i = 0; i < n; i++) {
      const id = `${advertiserId}-${String(i).padStart(3, "0")}`;
      const ts = `2026-05-15T12:${String(i).padStart(2, "0")}:00.000Z`;
      await auditStore.put(verdictRowFor(advertiserId, id, ts));
    }
  }

  it("nextCursor is a non-empty opaque string (not parseable JSON)", async () => {
    const { auditStore } = createStores();
    await seed("A", 60, auditStore);
    const page1 = await auditStore.query({ advertiserId: "A", limit: 30 });
    expect(typeof page1.nextCursor).toBe("string");
    expect(page1.nextCursor!.length).toBeGreaterThan(0);
    // A JSON.stringify({ts,id}) cursor would let a caller forge a
    // cross-tenant pivot by re-serializing with a different anchor.
    // The cursor MUST NOT be parseable JSON.
    expect(() => JSON.parse(page1.nextCursor!)).toThrow();
  });

  it("forged cursor resolves to { rows: [], nextCursor: null } (no enumeration)", async () => {
    const { auditStore } = createStores();
    await seed("A", 60, auditStore);
    const forged = Buffer.from("forged-by-attacker").toString("base64url");
    const result = await auditStore.query({
      advertiserId: "A",
      limit: 30,
      cursor: forged,
    });
    expect(result).toEqual({ rows: [], nextCursor: null });
  });

  it("A's cursor replayed under advertiserId B returns NO rows (forged-pivot defense)", async () => {
    const { auditStore } = createStores();
    await seed("A", 60, auditStore);
    await seed("B", 60, auditStore);

    const aPage1 = await auditStore.query({ advertiserId: "A", limit: 30 });
    expect(aPage1.nextCursor).not.toBeNull();

    // Caller swaps the advertiserId on the follow-up call. The cursor
    // anchor was issued for A; the resolver MUST reject A's anchor for
    // B (D7) — otherwise B sees A's rows.
    const replayed = await auditStore.query({
      advertiserId: "B",
      limit: 30,
      cursor: aPage1.nextCursor!,
    });
    expect(replayed.rows).toEqual([]);
    expect(replayed.nextCursor).toBeNull();
    // None of A's ids leaked through.
    expect(replayed.rows.every((r) => !r.id.startsWith("A-"))).toBe(true);
  });
});
