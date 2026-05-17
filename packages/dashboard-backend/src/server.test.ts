import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStores, type AuditStore } from "@scout/store";
import { createServer } from "./server.js";
import { evidenceInternals } from "./routes/evidence.js";
import { makeProfile, makeVerdictRow, verdictRowFor } from "./test-helpers.js";

function buildServer(allowlist: Map<string, string> = new Map()): {
  app: ReturnType<typeof createServer>;
  auditStore: AuditStore;
} {
  const { auditStore } = createStores();
  const app = createServer({ auditStore, sessionAllowlist: allowlist });
  return { app, auditStore };
}

const allowA = (): Map<string, string> => new Map([["sessA", "A"]]);

describe("@scout/dashboard-backend skeleton", () => {
  it("createServer is a function", () => {
    expect(typeof createServer).toBe("function");
  });
});

describe("preHandler — auth via x-advertiser-id allowlist", () => {
  it("missing x-advertiser-id header → 401", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/verdicts" });
    expect(res.statusCode).toBe(401);
  });

  it("unknown x-advertiser-id header → 401 (not in allowlist)", async () => {
    const { app } = buildServer(new Map());
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts",
      headers: { "x-advertiser-id": "not-in-allowlist" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("valid x-advertiser-id → reaches handler (not 401)", async () => {
    const { app } = buildServer(allowA());
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts",
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).not.toBe(401);
  });
});

describe("GET /api/verdicts — list happy path", () => {
  it("returns all 5 of A's verdict rows; nextCursor: null", async () => {
    const { app, auditStore } = buildServer(allowA());
    for (let i = 0; i < 5; i++) {
      await auditStore.put(
        verdictRowFor("A", `row-${i}`, `2026-05-15T12:0${i}:00.000Z`),
      );
    }
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts",
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ rows: unknown[]; nextCursor: string | null }>();
    expect(body.rows).toHaveLength(5);
    expect(body.nextCursor).toBeNull();
  });
});

describe("GET /api/verdicts/:id — single row", () => {
  it("owned id → 200 with the row body", async () => {
    const { app, auditStore } = buildServer(allowA());
    const row = verdictRowFor("A", "row-A-1", "2026-05-15T12:00:00.000Z");
    await auditStore.put(row);
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts/row-A-1",
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string }>();
    expect(body.id).toBe("row-A-1");
  });

  it("cross-tenant id → 404 (NOT 403, no enumeration)", async () => {
    const allow = new Map([
      ["sessA", "A"],
      ["sessB", "B"],
    ]);
    const { app, auditStore } = buildServer(allow);
    await auditStore.put(verdictRowFor("B", "row-B-1", "2026-05-15T12:00:00.000Z"));
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts/row-B-1",
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.statusCode).not.toBe(403);
  });

  it("nonexistent id → 404", async () => {
    const { app } = buildServer(allowA());
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts/does-not-exist",
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/verdicts — ETag + 304", () => {
  it("first GET returns an etag header (quoted sha256-hex)", async () => {
    const { app, auditStore } = buildServer(allowA());
    await auditStore.put(verdictRowFor("A", "r1", "2026-05-15T12:00:00.000Z"));
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts",
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(200);
    const etag = res.headers.etag;
    expect(typeof etag).toBe("string");
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
  });

  it("If-None-Match matching the current etag → 304, empty body", async () => {
    const { app, auditStore } = buildServer(allowA());
    await auditStore.put(verdictRowFor("A", "r1", "2026-05-15T12:00:00.000Z"));
    const first = await app.inject({
      method: "GET",
      url: "/api/verdicts",
      headers: { "x-advertiser-id": "sessA" },
    });
    const etag = first.headers.etag as string;
    const second = await app.inject({
      method: "GET",
      url: "/api/verdicts",
      headers: { "x-advertiser-id": "sessA", "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
  });

  it("after a new row is seeded, etag changes; old If-None-Match → 200", async () => {
    const { app, auditStore } = buildServer(allowA());
    await auditStore.put(verdictRowFor("A", "r1", "2026-05-15T12:00:00.000Z"));
    const first = await app.inject({
      method: "GET",
      url: "/api/verdicts",
      headers: { "x-advertiser-id": "sessA" },
    });
    const oldEtag = first.headers.etag as string;

    await auditStore.put(verdictRowFor("A", "r2", "2026-05-15T12:01:00.000Z"));

    const second = await app.inject({
      method: "GET",
      url: "/api/verdicts",
      headers: { "x-advertiser-id": "sessA", "if-none-match": oldEtag },
    });
    expect(second.statusCode).toBe(200);
    const newEtag = second.headers.etag as string;
    expect(newEtag).not.toBe(oldEtag);
  });
});

describe("GET /api/verdicts — cursor round-trip", () => {
  it("75 rows / limit 30 paginates via opaque cursor with no dup, no miss", async () => {
    const { app, auditStore } = buildServer(allowA());
    for (let i = 0; i < 75; i++) {
      const minute = String(Math.floor(i / 5)).padStart(2, "0");
      const ts = `2026-05-15T12:${minute}:00.000Z`;
      const id = `row-${String(i).padStart(3, "0")}`;
      await auditStore.put(verdictRowFor("A", id, ts));
    }

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string =
        cursor === null
          ? "/api/verdicts?limit=30"
          : `/api/verdicts?limit=30&cursor=${encodeURIComponent(cursor)}`;
      const res = await app.inject({
        method: "GET",
        url,
        headers: { "x-advertiser-id": "sessA" },
      });
      expect(res.statusCode).toBe(200);
      const body: { rows: Array<{ id: string }>; nextCursor: string | null } = JSON.parse(
        res.body,
      );
      for (const r of body.rows) collected.push(r.id);
      cursor = body.nextCursor;
      pages++;
      if (pages > 10) throw new Error("pagination did not terminate");
    } while (cursor !== null);

    expect(collected).toHaveLength(75);
    expect(new Set(collected).size).toBe(75);
  });
});

function encodeUri(uri: string): string {
  return Buffer.from(uri, "utf-8").toString("base64url");
}

describe("GET /api/evidence/:uri — streaming proxy + tenancy", () => {
  let tmpRoot: string;
  let aUri: string;
  let bUri: string;
  let aBytes: Buffer;
  let bBytes: Buffer;

  beforeAll(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "scout-evidence-"));
    aBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic-ish
    bBytes = Buffer.from([0x42, 0x42, 0x42, 0x42]);
    writeFileSync(join(tmpRoot, "a.png"), aBytes);
    writeFileSync(join(tmpRoot, "b.png"), bBytes);
    aUri = `file://${join(tmpRoot, "a.png")}`;
    bUri = `file://${join(tmpRoot, "b.png")}`;
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function buildAB(): { app: ReturnType<typeof createServer>; auditStore: AuditStore } {
    const allow = new Map([
      ["sessA", "A"],
      ["sessB", "B"],
    ]);
    const built = buildServer(allow);
    return built;
  }

  async function seedEvidence(
    auditStore: AuditStore,
    advertiserId: string,
    id: string,
    uri: string,
  ): Promise<void> {
    const row = makeVerdictRow({
      id,
      advertiserId,
      request: { advertiserId, pageUrl: "https://example.com/x" } as never,
      profile: makeProfile("https://example.com/x", [{ kind: "screenshot", uri }]),
    });
    await auditStore.put(row);
  }

  it("A's GET of base64url(A's own URI) → 200 with the file bytes", async () => {
    const { app, auditStore } = buildAB();
    await seedEvidence(auditStore, "A", "row-A-1", aUri);
    const res = await app.inject({
      method: "GET",
      url: `/api/evidence/${encodeUri(aUri)}`,
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.rawPayload).toEqual(aBytes);
  });

  it("A's GET of base64url(B's URI) → 404 AND fetchEvidenceStream is NEVER called", async () => {
    const spy = vi.spyOn(evidenceInternals, "fetchEvidenceStream");
    spy.mockClear();
    const { app, auditStore } = buildAB();
    await seedEvidence(auditStore, "A", "row-A-1", aUri);
    await seedEvidence(auditStore, "B", "row-B-1", bUri);

    const res = await app.inject({
      method: "GET",
      url: `/api/evidence/${encodeUri(bUri)}`,
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(404);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("malformed base64 (non-base64url chars) → 400", async () => {
    const { app } = buildAB();
    const res = await app.inject({
      method: "GET",
      url: "/api/evidence/not%21base64", // `!` is not base64url
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("valid base64url decoding to non-URI garbage → 400", async () => {
    const { app } = buildAB();
    // "hello" decodes to bytes that don't form a URI scheme.
    const res = await app.inject({
      method: "GET",
      url: "/api/evidence/aGVsbG8",
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Tenant isolation (LOAD-BEARING)", () => {
  function buildAB(): {
    app: ReturnType<typeof createServer>;
    auditStore: AuditStore;
  } {
    const allow = new Map([
      ["sessA", "A"],
      ["sessB", "B"],
    ]);
    return buildServer(allow);
  }

  it("A's list returns ONLY A's rows; B's list returns ONLY B's", async () => {
    const { app, auditStore } = buildAB();
    for (let i = 0; i < 3; i++) {
      await auditStore.put(
        verdictRowFor("A", `a-${i}`, `2026-05-15T12:0${i}:00.000Z`),
      );
      await auditStore.put(
        verdictRowFor("B", `b-${i}`, `2026-05-15T12:0${i}:30.000Z`),
      );
    }
    const aRes = await app.inject({
      method: "GET",
      url: "/api/verdicts",
      headers: { "x-advertiser-id": "sessA" },
    });
    const aBody = aRes.json<{ rows: Array<{ id: string; advertiserId: string }> }>();
    expect(aRes.statusCode).toBe(200);
    expect(aBody.rows.every((r) => r.advertiserId === "A")).toBe(true);
    expect(aBody.rows.map((r) => r.id).sort()).toEqual(["a-0", "a-1", "a-2"]);

    const bRes = await app.inject({
      method: "GET",
      url: "/api/verdicts",
      headers: { "x-advertiser-id": "sessB" },
    });
    const bBody = bRes.json<{ rows: Array<{ id: string; advertiserId: string }> }>();
    expect(bBody.rows.every((r) => r.advertiserId === "B")).toBe(true);
    expect(bBody.rows.map((r) => r.id).sort()).toEqual(["b-0", "b-1", "b-2"]);
  });

  it("A's GET of B's id → 404 (no enumeration)", async () => {
    const { app, auditStore } = buildAB();
    await auditStore.put(verdictRowFor("B", "b-secret", "2026-05-15T12:00:00.000Z"));
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts/b-secret",
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("A's ?advertiserId=B query is rejected by .strict() → 400 (does NOT leak B's rows)", async () => {
    const { app, auditStore } = buildAB();
    await auditStore.put(verdictRowFor("A", "a-1", "2026-05-15T12:00:00.000Z"));
    await auditStore.put(verdictRowFor("B", "b-1", "2026-05-15T12:00:00.000Z"));
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts?advertiserId=B",
      headers: { "x-advertiser-id": "sessA" },
    });
    // Either 400 (strict rejects) or 200 with only A's rows would be
    // tenant-safe. The PRP locks `.strict()` so 400 is the expected
    // shape; the assertion that B's rows are absent is the load-bearing
    // tenancy guarantee.
    expect(res.statusCode).toBe(400);
    const txt = res.body;
    expect(txt).not.toContain("b-1");
  });
});

describe("GET /api/verdicts — query validation", () => {
  it("limit=999 → 400 bad_query (zod max(200) fails)", async () => {
    const { app } = buildServer(allowA());
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts?limit=999",
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "bad_query" });
  });

  it("limit=0 → 400 (min(1) fails)", async () => {
    const { app } = buildServer(allowA());
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts?limit=0",
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("limit=30 numeric coercion → 200", async () => {
    const { app, auditStore } = buildServer(allowA());
    await auditStore.put(verdictRowFor("A", "r1", "2026-05-15T12:00:00.000Z"));
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts?limit=30",
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("decision=ZZZ (unknown enum) → 400", async () => {
    const { app } = buildServer(allowA());
    const res = await app.inject({
      method: "GET",
      url: "/api/verdicts?decision=ZZZ",
      headers: { "x-advertiser-id": "sessA" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Read-only seam (LOAD-BEARING)", () => {
  // The backend MUST NOT mutate the audit log. A future handler that
  // accidentally adds a write would surface here in CI before merge.
  it("no backend HTTP route calls auditStore.put", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "scout-seam-"));
    const fileUri = `file://${join(tmpRoot, "x.png")}`;
    writeFileSync(join(tmpRoot, "x.png"), Buffer.from([0xff]));

    const { auditStore } = createStores();
    const allow = new Map([["sessA", "A"]]);
    const app = createServer({ auditStore, sessionAllowlist: allow });

    // Seed BEFORE installing the spy — direct put for fixture seeding
    // is fine; the assertion targets BACKEND handler code paths.
    await auditStore.put(
      makeVerdictRow({
        id: "row-A-1",
        advertiserId: "A",
        request: { advertiserId: "A", pageUrl: "https://example.com/x" } as never,
        profile: makeProfile("https://example.com/x", [
          { kind: "screenshot", uri: fileUri },
        ]),
      }),
    );

    const spy = vi.spyOn(auditStore, "put");

    await app.inject({
      method: "GET",
      url: "/api/verdicts",
      headers: { "x-advertiser-id": "sessA" },
    });
    await app.inject({
      method: "GET",
      url: "/api/verdicts/row-A-1",
      headers: { "x-advertiser-id": "sessA" },
    });
    await app.inject({
      method: "GET",
      url: `/api/evidence/${encodeUri(fileUri)}`,
      headers: { "x-advertiser-id": "sessA" },
    });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    rmSync(tmpRoot, { recursive: true, force: true });
  });
});
