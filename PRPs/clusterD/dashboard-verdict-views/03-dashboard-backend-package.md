name: "Dashboard — PRP 03: `@scout/dashboard-backend` Fastify ESM package (TDD)"
description: |

  Third of seven PRPs implementing `features/clusterD/dashboard-verdict-views.md`.
  This PRP stands up a NEW workspace package `@scout/dashboard-backend` at
  `packages/dashboard-backend/`: a thin Fastify ESM app that proxies
  `AuditStore` reads with tenant scoping. Three routes: list verdicts,
  single verdict, evidence proxy. Auth is a stub `preHandler` validating
  `x-advertiser-id` against an injected `Map`. No views (PRPs 04–07).

  Depends on PRPs 01 + 02: assumes `AuditRowSchema` lives in
  `@scout/shared` and `AuditStore.query` / `AuditStore.get` exist on the
  `@scout/store` interface with the signatures locked at
  `features/clusterD/dashboard-verdict-views.md:27-39`.

  ## TDD discipline

  Mirrors `PRPs/clusterB/harness-contracts.md:10-34`. Every task is
  **red → green → refactor**: (1) test first, run, confirm fail for the
  *expected reason* (route 404 / module not found / `TS2307`) — wrong
  reason (typo, syntax) is not a real red; (2) minimum impl to flip
  green, resist speculative fields; (3) tidy after green; `tsc --noEmit`
  + `eslint --fix` stay clean. Commit at green; never commit red unless
  the message says `WIP — red`.

  ## Why this PRP exists separately

  The dashboard SPA (PRPs 04–07) cannot import `@scout/store` directly —
  the foundation ESLint boundary at
  `PRPs/foundation-ad-verification.md:155-156` blocks it. The dashboard
  reads audit rows over HTTP; this package is that HTTP seam. Keeping
  it out of `@scout/gate` preserves hot-path / warm-read isolation: a
  slow dashboard query cannot regress the gate's sub-second SLA.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A. Off the hot path; the dashboard is the
    read side of an async-written audit log (gate writes via
    `setImmediate` after `reply.send()` per
    `features/clusterA/gate-verdict-logic.md:97`). No contribution to
    gate's P99.
  - **Pre-bid** — N/A. Post-bid governance surface.
  - **Plug-and-play** — The three routes ARE the production seam. Real
    OIDC swaps the `preHandler`; the stub allowlist is
    constructor-injected. The SPA depends on the wire shape, not auth.
  - **Sponsor tech** — No LLM here. Lobster Trap data is reached
    read-only via the `lobstertrapTraceId` linkage on the `AuditRow`
    (resolved inside the handler in PRP 07); this PRP does NOT proxy
    to Lobster Trap.

  ## CLAUDE.md rules that bite

  - § Working agreements — *"Ask before scaffolding new packages."*
    This PRP IS the asking; the decisions table is the contract.
  - § Working agreements — 300-line cap on impl files; extract
    per-route handlers if a route file grows past.
  - § Working agreements — no secrets in client; corollary here:
    server-side `advertiserId` derivation only.
  - § Stack — Fastify ESM `^5.0.0` is the locked runtime; mirror it.

  ## Decisions (locked here)

  | # | Question | Locked answer | Why |
  |---|---|---|---|
  | D1 | Fastify version | `^5.0.0` | Mirror `packages/gate/package.json:16`; no second runtime. |
  | D2 | Routes prefix | `/api` | Matches `features/clusterD/dashboard-verdict-views.md:42`. SPA dev server proxies `/api` → backend. |
  | D3 | Session validation | In-memory `Map<string, string>` (`headerValue → advertiserId`) injected into `createServer({ sessionAllowlist })`. | Stub for v1; real OIDC filed as `dashboard-auth.md`. Constructor-injected so tests seed directly without a script. |
  | D4 | `advertiserId` source | Derived in `preHandler` from `x-advertiser-id` header; NEVER from query string. | Tenant isolation (HARD). A `?advertiserId=B` query param is silently ignored — no code path reads it. |
  | D5 | ETag algorithm | sha256-hex of the serialized JSON response body. | Stable, content-addressed; 304 path on poll cadence is load-bearing per `features/clusterD/dashboard-verdict-views.md:59`. |
  | D6 | Cursor opacity | Delegated to `AuditStore.query`'s `cursor` (opaque string from PRP 02). | Backend never inspects the cursor; round-trips it verbatim. |
  | D7 | Evidence URI encoding | base64-url (RFC 4648 §5) of the original `EvidenceRef.uri`. | URL-safe, no padding ambiguity in path segments. |
  | D8 | Cross-tenant response | **404, not 403**, on every route (single-row, evidence). | No enumeration. Same principle as `features/clusterA/gate-verdict-logic.md:102`. |
  | D9 | Evidence Content-Type | Sniffed from the URI path extension by Fastify; fallback `application/octet-stream`. | Streaming endpoint; no buffering. Real impls (S3, signed URLs) may set Content-Type upstream. |
  | D10 | Evidence streaming | `reply.raw.pipe(upstream)` — no buffering. | 5 MB screenshot × N concurrent requests = DoS surface even on demo machine (`features/clusterD/dashboard-verdict-views.md:169`). |
  | D11 | Read-only seam enforcement | `vi.spyOn(auditStore, "put")` zero-call assertion across the full suite. | Test-layer guarantee that the backend never mutates the audit log. |

  ## All Needed Context

  ```yaml
  - file: features/clusterD/dashboard-verdict-views.md
    section: "FEATURE — backend routes (lines 41-55);
      Tenant isolation (lines 137-142);
      No secrets in client (lines 130-135);
      Gotchas — streaming + CORS (lines 163-174)"
    why: Source spec for routes, auth, tenant isolation, evidence proxy.

  - file: packages/gate/package.json
    why: Fastify version precedent (^5.0.0); devDeps shape this PRP mirrors.

  - file: packages/gate/src/index.ts
    why: Fastify ESM patterns in-repo (if present). Mirror createServer
      signature shape (deps-by-object).

  - file: packages/store/src/index.ts
    why: AuditStore interface. PRP 02 extends with `query` + `get`; this
      PRP consumes them. Field name alignment is load-bearing.

  - file: packages/shared/src/index.ts
    why: Wire schemas the routes serialize (AuditRow, Decision). Re-exports
      consumed by the SPA in PRPs 04-07.

  - file: PRPs/clusterD/01-audit-and-intent-contracts.md
    why: AuditRowSchema discriminated union — single-row + list responses
      conform to it.

  - file: PRPs/foundation-ad-verification.md
    section: "Q2 (line 25) Fastify lock; ESLint boundary (lines 155-156)"
    why: Runtime lock + the boundary that makes this package necessary.

  - url: https://fastify.dev/docs/latest/Reference/ESM/
    why: Fastify v5 ESM bootstrap; `type: "module"` requirements.

  - url: https://developer.mozilla.org/en-US/docs/Web/HTTP/Conditional_requests
    why: ETag + If-None-Match semantics; 304 with no body.

  - url: https://datatracker.ietf.org/doc/html/rfc4648#section-5
    why: base64-url encoding (URL-safe, no padding in path segments).
  ```

  ## Files to create

  - `packages/dashboard-backend/package.json`
  - `packages/dashboard-backend/tsconfig.json`
  - `packages/dashboard-backend/vitest.config.ts`
  - `packages/dashboard-backend/src/server.ts`
  - `packages/dashboard-backend/src/auth.ts`
  - `packages/dashboard-backend/src/etag.ts`
  - `packages/dashboard-backend/src/routes/verdicts.ts`
  - `packages/dashboard-backend/src/routes/evidence.ts`
  - `packages/dashboard-backend/src/server.test.ts`

  ## Files to modify

  Root `pnpm-workspace.yaml` already includes `packages/*`; no edit
  needed. No barrel changes elsewhere — this package exposes
  `createServer` from `src/server.ts` consumed by the future
  `@scout/scripts.startDashboardBackend` runner (out of scope here).

  ## Target interface (pseudocode; ≤80 lines combined)

  ```ts
  // src/server.ts
  import Fastify, { FastifyInstance } from "fastify";
  import type { AuditStore } from "@scout/store";
  import { makePreHandler } from "./auth.js";
  import { registerVerdictRoutes } from "./routes/verdicts.js";
  import { registerEvidenceRoutes } from "./routes/evidence.js";

  export interface ServerDeps {
    auditStore: AuditStore;
    sessionAllowlist: Map<string, string>; // headerValue -> advertiserId
  }

  export function createServer(deps: ServerDeps): FastifyInstance {
    const app = Fastify({ logger: false }); // logger off: raw row content (_lobstertrap.declared_intent) MUST NOT log
    app.addHook("preHandler", makePreHandler(deps.sessionAllowlist));
    registerVerdictRoutes(app, deps.auditStore);
    registerEvidenceRoutes(app, deps.auditStore);
    return app;
  }

  // src/auth.ts — preHandler
  export function makePreHandler(allow: Map<string, string>) {
    return async (req, reply) => {
      const header = req.headers["x-advertiser-id"];
      if (typeof header !== "string") return reply.code(401).send();
      const advertiserId = allow.get(header);
      if (!advertiserId) return reply.code(401).send();
      (req as any).advertiserId = advertiserId; // server-side only; never from query
    };
  }

  // src/routes/verdicts.ts — list + single
  const ListQuery = z.object({
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    decision: DecisionSchema.optional(),
    pageUrl: z.string().optional(),
    kind: z.enum(["verdict", "profile_job_dlq"]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  }).strict();

  app.get("/api/verdicts", async (req, reply) => {
    const parsed = ListQuery.safeParse(req.query); // ?advertiserId=B silently ignored (.strict() rejects unknown keys)
    if (!parsed.success) return reply.code(400).send({ error: "bad_query" });
    const advertiserId = (req as any).advertiserId; // NEVER from query
    const result = await auditStore.query({ advertiserId, ...parsed.data });
    const body = JSON.stringify(result);
    const etag = `"${sha256Hex(body)}"`;
    if (req.headers["if-none-match"] === etag) return reply.code(304).send();
    reply.header("etag", etag).type("application/json").send(body);
  });

  app.get("/api/verdicts/:id", async (req, reply) => {
    const advertiserId = (req as any).advertiserId;
    const row = await auditStore.get(advertiserId, req.params.id);
    if (!row) return reply.code(404).send(); // 404, NOT 403 — no enumeration
    reply.send(row);
  });

  // src/routes/evidence.ts — streaming proxy
  app.get("/api/evidence/:uri", async (req, reply) => {
    const advertiserId = (req as any).advertiserId;
    const decoded = base64UrlDecode(req.params.uri);
    const owns = await auditStoreOwnsEvidence(auditStore, advertiserId, decoded);
    if (!owns) return reply.code(404).send(); // never proxies cross-tenant bytes
    const upstream = await fetchEvidenceStream(decoded);
    reply.type(sniffContentType(decoded) ?? "application/octet-stream");
    return reply.send(upstream); // Fastify pipes Readable streams; no buffering
  });
  ```

  ## Task order (TDD; commit-sized)

  ### Task 1 — Package skeleton

  Create `package.json` (deps + devDeps per spec), `tsconfig.json`
  (extends `../../tsconfig.base.json`), `vitest.config.ts`. Empty
  `src/server.ts` exports placeholder `createServer`. Smoke test
  imports it and asserts it's a function. Commit.

  ### Task 2 — `preHandler`

  Two test cases (red): empty allowlist + missing `x-advertiser-id` →
  401; empty allowlist + unknown header → 401. Green: `src/auth.ts`
  per pseudocode, registered in `createServer`. Commit.

  ### Task 3 — List route happy path

  Seed 5 `kind: "verdict"` rows for A. `GET /api/verdicts` with
  `x-advertiser-id: sessA` → `{ rows: [5], nextCursor: null }`. Green:
  `src/routes/verdicts.ts` list handler. Commit.

  ### Task 4 — List query validation

  `GET /api/verdicts?limit=999` → 400 (zod parse fail). Green:
  `ListQuery.safeParse` + 400 branch. Commit.

  ### Task 5 — Single-row route

  Tests: owned → 200 + body; cross-tenant id → 404 (NOT 403); missing
  id → 404. Green: `:id` handler. Commit.

  ### Task 6 — Tenant isolation (list + single)

  Seed A and B. Assert: A's list returns ONLY A's rows; A's GET of
  B's id → 404; A's `?advertiserId=B` query returns A's rows only
  (silently ignored by `.strict()` zod). Should pass after 3 + 5; if
  not, bug lives in `auth.ts`. Commit.

  ### Task 7 — ETag + 304

  Tests: first GET returns `etag` header; second GET with
  `If-None-Match: <etag>` → 304, empty body; after new row seeded,
  etag changes and old `If-None-Match` → 200. Green: `src/etag.ts`
  (`sha256Hex(body)`), wired into list handler. Commit.

  ### Task 8 — Evidence route + tenancy

  Seed A with `evidenceRefs: [{ uri: "file:///tmp/a.png" }]` and B
  with `[{ uri: "file:///tmp/b.png" }]`. Assert: A's GET of
  base64url(a-uri) → 200 with bytes (tmp file in test setup); A's
  GET of base64url(b-uri) → 404 with **NO bytes streamed** (spy on
  `fetchEvidenceStream`, assert zero calls for the cross-tenant
  case); malformed base64 → 400. Green: `src/routes/evidence.ts`.
  Ownership check walks `auditStore.query({ advertiserId })` and
  returns true iff any row's `evidenceRefs[].uri` matches. Commit.

  ### Task 9 — Cursor round-trip

  Seed 75 rows for A. List with `limit: 30`; assert `rows.length ===
  30` and `nextCursor !== null`. Re-call with returned `cursor` +
  same `limit` until `nextCursor === null`. Assert total === 75; no
  duplicate ids. Green: handler forwards `cursor` verbatim. Commit.

  ### Task 10 — Final sweep

  Add read-only seam assertion: `vi.spyOn(auditStore, "put")` at
  `beforeAll`; `afterAll` asserts call count === 0. Run validation:

  ```bash
  pnpm --filter @scout/dashboard-backend test
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r build
  pnpm audit
  ```

  Refactor: if `src/routes/verdicts.ts` exceeds 250 lines, extract
  `listHandler` and `singleHandler` into siblings. Commit.

  ## Security guardrails

  - **`advertiserId` is server-side only.** Derived in `preHandler` from
    `x-advertiser-id`, attached to `req`, never read from query string
    or body. A `?advertiserId=B` query param is silently ignored
    (the `.strict()` zod schema doesn't allow it, AND the handler does
    not read it even if it did).
  - **404, not 403, on cross-tenant access.** Single-row + evidence
    routes return 404 for rows / URIs not owned by the authenticated
    advertiser. Adversary cannot enumerate which IDs exist in other
    tenants. Same principle as `features/clusterA/gate-verdict-logic.md:102`.
  - **Evidence ownership validated BEFORE streaming.** No code path
    calls `fetchEvidenceStream(decoded)` until the ownership check
    passes. Test pins this via spy assertion (zero calls in
    cross-tenant case).
  - **Server-side field filtering.** Routes return only the fields the
    dashboard renders; no spread of the full audit row across the wire
    boundary. Advertiser-private fields (`Policy.rules[].match` strings,
    etc.) never leave the server. (PRP 02's `AuditRow` shape excludes
    them; this PRP relies on that.)
  - **No raw row logging.** `Fastify({ logger: false })`. `AuditRow`
    rows may carry `_lobstertrap.declared_intent` containing untrusted
    page content; `app.log.info(req.body)` is the bug this rule
    prevents. Anti-pattern listed below.
  - **Read-only seam (test-enforced).** `vi.spyOn(auditStore, "put")`
    asserts zero calls across the full suite. If a future handler
    accidentally writes, CI fails.

  ## Out of scope

  - Real OIDC / SSO auth — `dashboard-auth.md` follow-up.
  - Rate limiting — follow-up; demo machine doesn't need it.
  - CORS — the dashboard SPA is same-origin-served via Vite proxy in
    dev (`/api` proxied to backend port); production is same-origin
    too. No `@fastify/cors` install. Document in Gotchas below.
  - Lobster Trap audit-log proxying — the `IntentDiff` view (PRP 07)
    fetches via the `lobstertrapTraceId` linkage already on the
    `AuditRow`. Backend does NOT proxy directly to Lobster Trap in v1.
  - SQLite-backed `AuditStore` — foundation Q3 names `better-sqlite3`;
    PRP 02 may stub in-memory; either way this backend doesn't care.
  - Polling / SSE — PRP 04+ wires the SPA's `@tanstack/react-query`
    polling; this PRP just serves the GETs.
  - Reading `seedDashboardSessions` script — the v1 contract is
    constructor injection of the `Map`. The seed script is a follow-up.

  ## Gotchas

  - **CORS not added.** Dev: Vite proxies `/api` → backend. Prod: same
    origin. Adding `@fastify/cors` later is a one-line plugin
    registration; do not add it speculatively now.
  - **Evidence Content-Type.** Sniffed from path extension; real-world
    URIs without extensions fall back to `application/octet-stream`.
    Browsers will offer to download rather than render — acceptable
    for v1; document if a judge asks.
  - **Cursor opacity.** The backend never inspects the cursor string.
    If PRP 02's `AuditStore.query` shape changes the cursor encoding,
    this package needs zero edits.

  ## Anti-patterns

  - Don't accept `advertiserId` from query string, body, or any
    request-controlled source. Header-via-preHandler-via-allowlist
    only.
  - Don't return 403 on cross-tenant access. 404 prevents enumeration.
  - Don't buffer the evidence stream. `reply.raw.pipe(upstream)` /
    `reply.send(stream)` only. A 5 MB screenshot × N concurrent
    requests is a DoS surface.
  - Don't add `app.log.info(req.body)` / `app.log.info(row)` calls.
    Raw row content (`_lobstertrap.declared_intent`) carries
    untrusted page text. `Fastify({ logger: false })` is intentional.
  - Don't skip ETag. The polling cadence in PRP 04+ depends on 304s
    for cheap idle pings; without it the demo machine bursts.
  - Don't widen `sessionAllowlist` to a function / async lookup
    speculatively. The injected `Map` is the v1 contract; real auth
    swaps the `preHandler`, not the data shape.
  - Don't drop `.strict()` on `ListQuery`. The `?advertiserId=B`
    silent-ignore depends on it (unknown keys rejected → handler
    never sees them).
  - Don't add `@fastify/cors` unless a CORS bug surfaces. Same-origin
    in dev + prod.

  ## Confidence: 8 / 10

  Greenfield package with clear precedent (`@scout/gate`'s Fastify
  setup). Two risks: (1) PRP 02's `AuditStore.query` signature may
  diverge from `features/clusterD/dashboard-verdict-views.md:27-39`
  (e.g., named-param order, error variants) — task 3 surfaces this
  immediately as a type mismatch; fix by adjusting the handler call
  site, not the schema. (2) Evidence ownership lookup walks
  `auditStore.query` results, which is O(N) per request on the
  in-memory impl; acceptable for the demo (≤200 rows per advertiser),
  but a real impl needs a `findByEvidenceUri` lookup — file as a
  follow-up if PRP 02's interface doesn't already expose it.
