name: "Dashboard — PRP 02: `AuditStore` tenant-scoped read interface (TDD)"
description: |

  Second of seven PRPs implementing `features/clusterD/dashboard-verdict-views.md`.
  Extends `packages/store/src/index.ts` with `AuditStore.query()` + `get()`,
  refactors the local `AuditRow` interface to consume `AuditRowSchema` from
  `@scout/shared` (landed by PRP 01), and adds a tenant-scoped in-memory
  impl with opaque cursor pagination. The contract test pins cross-tenant
  isolation at the store layer.

  No backend HTTP routes (PRP 03), no React (PRP 04+), no Redis/sqlite
  impls (foundation Q3 follow-ups).

  ## TDD discipline

  Mirrors `PRPs/clusterB/harness-contracts.md` § "TDD discipline" verbatim.
  Every task is **red → green → refactor**:

  1. **Red.** Write the test first. Run
     `pnpm --filter @scout/store test -- <file>`. Confirm it fails for
     the *expected reason* — usually `Property 'query' does not exist
     on type 'AuditStore'` (TS2339) or `Cannot find module`. A test
     that fails for the wrong reason (typo, syntax) is not a real red.
  2. **Green.** Minimum impl to flip the test. Resist adding fields the
     test doesn't exercise.
  3. **Refactor.** Only after green: tidy names, run
     `pnpm -r exec tsc --noEmit` + `eslint --fix`. Tests still green.

  Commit at green. Never commit at red unless the message says
  `WIP — red`.

  ## Why this PRP exists separately

  - **Separates schema (PRP 01) from runtime impl.** PRP 01 lands the
    pure zod type; this PRP wires the in-memory store to it and exposes
    the read seam. Both diffs stay small; PRP 01 lands without touching
    `@scout/store` or `@scout/gate`.
  - **Unblocks PRP 03 (backend).** The Fastify routes have nothing to
    wrap until `query()` + `get()` exist. Standing them up here means
    PRP 03 is pure HTTP plumbing.
  - **Unblocks the future SQLite-backed impl** (foundation Q3 names
    `better-sqlite3`). The interface this PRP locks IS the
    productionization seam.
  - **Cluster B precedent for splitting contract from impl.**
    `PRPs/clusterB/harness-contracts.md` is contracts-only; the SDK
    install is its own PRP. Same shape here.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A. Dashboard is read-side of an async-written
    log (`features/clusterD/dashboard-verdict-views.md:9`). In-memory
    `query()` is microsecond-bounded; the `limit ≤ 200` cap (D3) is the
    safety rail even with a 10k-row store.
  - **Pre-bid** — Honored. Gate's `auditStore.put` stays fire-and-forget
    via `setImmediate` per `features/clusterA/gate-verdict-logic.md:97`
    and `packages/gate/src/handler.ts:156`. This PRP only changes the
    `put` arg shape (discriminated-union); dispatch pattern untouched.
  - **Plug-and-play** — This PRP IS the productionization seam.
    `query()` + `get()` are the typed boundary sqlite/postgres/Redis
    impls drop behind. No caller change at swap time.
  - **Sponsor tech** — No LLM call. The advertiser-private `_lobstertrap`
    payloads carried inside `AuditRow.declaredIntent` /
    `detectedIntent` are stored opaquely; never logged.

  ## CLAUDE.md rules that bite

  - § Stack — zod at every cross-package contract. `AuditRow` is
    imported from `@scout/shared`; not redeclared.
  - § Working agreements — files ≤ ~300 lines. Impl after this PRP is
    ~150 lines.
  - § Working agreements — 1 happy / 1 edge / 1 failure per new file.
    `audit.test.ts` exceeds the minimum because tenancy and pagination
    are load-bearing.
  - § Working agreements — security-touching code states assumptions
    explicitly. Tenant isolation IS a security boundary; cursor opacity
    (D1) cites the threat model.

  ## Decisions (locked here)

  | # | Question | Locked answer + rationale |
  |---|---|---|
  | D1 | Cursor encoding | **Server-side state**: cursor = `base64url(randomUUID())`; impl maintains `Map<token, {advertiserId, ts, id}>`. Tokens evict after 5 min idle. NOT HMAC (no key-mgmt story in v1; server-side state defeats forged pivots by construction). SQLite/Redis impl can swap to HMAC. |
  | D2 | Cursor stability under concurrent writes | Cursor anchors the previous page's last row (`{ts, id}`). Reads are strictly older-than-anchor. New rows surface on next "refresh from top" (1s poll), not mid-pagination. Avoids skip/duplicate without snapshot isolation. |
  | D3 | `limit` cap | Hard cap **200**, default **50**. Values >200 throw `RangeError("limit exceeds 200")`. Bounds in-memory sort+copy. |
  | D4 | Pagination tiebreaker | Reverse-chrono by `ts` (ISO-8601 string compare is lexicographic-correct), tiebreak by `id` desc. Deterministic total order — required or pagination skips/duplicates. |
  | D5 | `query()` without `advertiserId` | **TypeScript compile error** (filter type has `advertiserId: string` required). No runtime check — type system enforces. |
  | D6 | `get(advertiserId, id)` cross-tenant | Returns `null` (same as "no such id"). Caller cannot distinguish — prevents enumeration. Matches 404-not-403 from `gate-verdict-logic.md:102` and `dashboard-verdict-views.md:140`. |
  | D7 | `kind` filter default | Unset → both variants. Dashboard's "Verdicts" tab passes `kind: "verdict"` explicitly. |
  | D8 | Where `AuditRow` lives | `@scout/shared` only. The local interface at `packages/store/src/index.ts:18-24` is deleted. PRP 01 is the single source. |

  ## All Needed Context

  ```yaml
  - file: PRPs/clusterD/01-audit-and-intent-contracts.md
    why: This PRP imports `AuditRow` + `AuditRowSchema` from `@scout/shared`.
      MUST be merged before this PRP starts. If 01 isn't on `main`, stop.

  - file: features/clusterD/dashboard-verdict-views.md
    section: "lines 26-40 (AuditStore read interface signatures);
      lines 137-143 (tenant isolation HARD section)"
    why: Authoritative source for the `query()` + `get()` shapes and the
      tenant-isolation contract this PRP pins at the store layer.

  - file: PRPs/clusterB/harness-contracts.md
    why: Style template. TDD discipline section copied verbatim;
      decision-table format mirrored; task-order shape mirrored.

  - file: packages/store/src/index.ts
    why: The file being modified. Current local `AuditRow` interface
      (lines 18-24) is deleted; current `AuditStore.put` (line 27)
      arg type changes; in-memory `auditStore` (lines 73-78) gains
      `query` + `get` impls and a tracking `AuditRow[]`.

  - file: packages/store/package.json
    why: Already depends on `@scout/shared` (line 12). No new deps needed.
      Devdep `vitest` will be needed for the test file — verify via
      `pnpm -w list vitest`; foundation already pulls it workspace-root.

  - file: packages/gate/src/handler.ts
    section: "lines 154-169 (setImmediate auditStore.put block)"
    why: ONE-LINE migration: the put payload must add
      `kind: "verdict" as const` (and `advertiserId` from the request)
      to match the discriminated-union shape PRP 01 landed. Document
      the migration step explicitly in Task 1.

  - file: packages/gate/src/handler.failure.test.ts
    section: "lines 151-180 (audit-store call assertions)"
    why: These tests spy on `auditStore.put`; the spy signature changes
      with the new arg type. Adjust the test fixtures' expected-arg
      shape in Task 1.

  - file: features/clusterA/gate-verdict-logic.md
    section: "line 97 (fire-and-forget put);
      line 102 (404-not-403 enumeration principle)"
    why: Confirms `put` stays fire-and-forget (this PRP doesn't change
      that) and pins the cross-tenant `get → null` rationale (D6).
  ```

  ## Files to create

  - `packages/store/src/audit.test.ts` — NEW. The TDD test file driving
    all six task pairs below. Vitest + `createStores()` from index.ts.

  ## Files to modify

  - `packages/store/src/index.ts` —
    1. Delete local `AuditRow` interface (lines 18-24).
    2. Add `import { AuditRow } from "@scout/shared"` at the top.
    3. Extend `AuditStore` interface with `query` + `get` methods.
    4. Replace the no-op `auditStore` in `createStores()` with a tracking
       impl backed by an `AuditRow[]` + a cursor-token `Map`.
  - `packages/gate/src/handler.ts` — one-line change to the `put` payload:
    add `kind: "verdict" as const, advertiserId: <from request>`.
  - `packages/gate/src/handler.failure.test.ts` — update the
    spy-expected-arg shape to include `kind` + `advertiserId`.

  No new dependencies. `@scout/shared` already a dep; vitest is workspace-root.

  ## Target contract — `packages/store/src/index.ts` (post-refactor, ≤40 lines of the interface block)

  ```ts
  import type {
    AuditRow,             // discriminated union from PRP 01
    Decision,             // "ALLOW" | "DENY" | "HUMAN_REVIEW"
    PageProfile,
    Policy,
    BidVerificationRequest,
    VerificationVerdict,
  } from "@scout/shared";

  export interface AuditQueryFilter {
    advertiserId: string;                          // REQUIRED — tenant scope
    since?: string;                                // ISO-8601 datetime
    until?: string;
    decision?: Decision;
    pageUrl?: string;                              // exact match; v1 not substring
    kind?: "verdict" | "profile_job_dlq";
    limit?: number;                                // ≤ 200, default 50
    cursor?: string;                               // opaque pagination token
  }

  export interface AuditQueryResult {
    rows: AuditRow[];
    nextCursor: string | null;
  }

  export interface AuditStore {
    put(row: AuditRow): Promise<void>;
    query(filter: AuditQueryFilter): Promise<AuditQueryResult>;
    get(advertiserId: string, id: string): Promise<AuditRow | null>;
  }
  ```

  Re-export `AuditQueryFilter` + `AuditQueryResult` from `@scout/store`'s
  barrel so PRP 03's backend can import the wire shapes directly.

  ## Task order (TDD; commit-sized)

  ### Task 1 — Refactor: replace local `AuditRow` with shared import + gate migration

  **Type-only; no new tests.**

  1. Delete `packages/store/src/index.ts:18-24` (`interface AuditRow`).
  2. Add `import type { AuditRow } from "@scout/shared"`.
  3. Update `packages/gate/src/handler.ts:158-164` to the
     discriminated-union shape:
     ```ts
     await deps.auditStore.put({
       kind: "verdict",
       id: randomUUID(),
       advertiserId: (req.body as BidVerificationRequest).advertiserId,
       ts: new Date().toISOString(),
       request: req.body as BidVerificationRequest,
       verdict: v,
       profile: null,
       declaredIntent: null,
       detectedIntent: null,
     });
     ```
     Exact field names defer to PRP 01's `AuditRowSchema`.
  4. Update `packages/gate/src/handler.failure.test.ts:179` spy
     expectation to match.
  5. `pnpm -r exec tsc --noEmit` + `pnpm --filter @scout/gate test`
     must pass.

  Commit: `refactor(store): consume AuditRow from @scout/shared`.

  ### Task 2 — Red→Green: happy round-trip

  Write `packages/store/src/audit.test.ts` with one test: insert one
  `AuditRow`, then `query({ advertiserId: "A" })` returns it, then
  `get("A", row.id)` returns it. Red (no `query`); add `query` + `get`
  to interface AND impl:
  ```ts
  const rows: AuditRow[] = [];
  // put: rows.push(row);
  // query: filter advertiserId, sort desc by (ts, id), slice limit.
  // get: rows.find(r => r.advertiserId===adv && r.id===id) ?? null
  ```
  Green. Refactor: extract sort comparator.

  ### Task 3 — Red→Green: filter axes

  One test per filter (`decision`, `pageUrl`, `kind`, `since`/`until`).
  Each red first (filter missing), then green (add the clause):

  - 3 rows mixed `decision`; `decision: "DENY"` returns only DENY.
  - 3 rows mixed `pageUrl`; exact-match returns one.
  - 1 `verdict` + 1 `profile_job_dlq`; `kind: "profile_job_dlq"`
    returns only DLQ.
  - Rows at `2026-05-01`, `-15`, `-30`; `since: -10, until: -20`
    returns the middle row.

  ### Task 4 — Red→Green: empty store edge

  `query({ advertiserId: "A" })` → `{ rows: [], nextCursor: null }`.
  `get("A", "nope")` → `null`. Red: impl might throw on empty rows.
  Green: guard.

  ### Task 5 — Red→Green: pagination — 75 rows, limit 30, two cursor follows

  Insert 75 rows for A (varied `ts`, distinct `id`s). Call query three
  times following `nextCursor`. Assertions:

  - Lengths: 30, 30, 15. `page3.nextCursor === null`.
  - Concatenated ids: 75 unique, no duplicate, no miss.
  - Order monotonic `ts` desc, `id` desc tiebreak (D4).

  Red: cursor impl missing/off-by-one. Green: cursor-token Map; on
  `cursor` present, look up anchor and filter to strictly-older-than
  `(ts, id)`. Set `nextCursor` only if rows remain after the slice.

  ### Task 6 — Red→Green: tenant isolation (LOAD-BEARING)

  Insert 5 rows for A and 5 for B (mixed `kind`, `ts`).

  - `query({ advertiserId: "A", since: "1970-01-01T00:00:00Z" })` →
    exactly 5 A-rows; no B-rows.
  - For each B-row id: `get("A", b.id)` → `null` (NOT throws).
  - Symmetric for B.

  Red: filter missing the scope check. Green: add it.

  Compile-time test:
  ```ts
  // @ts-expect-error advertiserId is required by AuditQueryFilter
  void store.query({ since: "1970-01-01T00:00:00Z" });
  ```
  `pnpm -r exec tsc --noEmit` must pass. If the line type-checks (no
  error to expect), the filter type is wrong; tighten it.

  ### Task 7 — Red→Green: cursor opacity

  - `nextCursor` is a non-empty string.
  - `JSON.parse(cursor)` throws (cursor MUST NOT be parseable JSON
    a caller could craft).
  - Forged cursor (e.g., `base64url("forged")`) on `query({advertiserId:
    "A", cursor: <forged>})` either throws `Error("invalid cursor")` OR
    returns `{rows: [], nextCursor: null}`. Implementer picks one;
    document in JSDoc. Either is safe.
  - **Load-bearing**: cursor issued for A, replayed with `advertiserId:
    "B"` MUST NOT return A's rows. Either throws
    `Error("cursor advertiser mismatch")` OR returns
    `{rows: [], nextCursor: null}`. Without this, caller-forged
    cross-tenant cursors pivot to another advertiser's data.

  Red: impl accepts cross-tenant cursor. Green: token Map stores
  `{advertiserId, ts, id}`; resolver checks token's `advertiserId ===
  filter.advertiserId` and rejects on mismatch.

  ### Task 8 — Full validation sweep

  ```bash
  pnpm --filter @scout/store test
  pnpm --filter @scout/shared test     # PRP 01 still passes
  pnpm --filter @scout/gate test       # put migration holds
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r build
  ```

  No `pnpm audit` regression — no runtime deps added.

  ## Security guardrails

  - **Tenant isolation IS the point.** Tasks 6 + 7 pin it at type
    system (D5) and runtime (D6, D7). No code path returns B's data to
    a caller passing A's `advertiserId`.
  - **Cursor opacity prevents forged pivot.** D1: cursor is an opaque
    random token; `{advertiserId, ts, id}` anchor lives in the impl's
    Map; forged token resolves to nothing; A's token rejected for B at
    resolve time.
  - **No env access.** Only deps are `@scout/shared` types. If you find
    yourself reading `process.env.*`, you're in the wrong PRP.
  - **Never log raw row content.** Rows carry advertiser-private
    `_lobstertrap` payloads via PRP 01's intent fields. Any
    `console.*` here MUST log only `{id, advertiserId, kind}` — never
    the full row.
  - **`limit > 200` throws, doesn't silently clamp.** A 10k-row ask is
    a bug; surface it. PRP 03's backend enforces the same cap at HTTP
    so the throw never reaches a user.

  ## Out of scope

  - **Redis-backed `AuditStore` impl.** Foundation Q3 names `ioredis`
    for queue/cache, not audit. File as a follow-up if the demo grows
    a multi-process need.
  - **SQLite-backed `AuditStore` impl.** Foundation Q3 names
    `better-sqlite3` for `AuditStore`. The interface this PRP locks IS
    the seam; file the impl as `store-audit-sqlite.md` follow-up.
  - **Backend HTTP routes.** PRP 03.
  - **Substring `pageUrl` search.** v1 is exact match
    (`features/clusterD/dashboard-verdict-views.md:33`). Add `LIKE` /
    full-text search in a follow-up when the dashboard needs it.
  - **`AuditStore.delete` / retention policy.** No row eviction in v1.
    File as `store-audit-retention.md` when the demo's row count
    exceeds 10k (unlikely on stage).
  - **Cross-process cursor stability.** D1's server-side state is
    per-process. Multi-process / multi-replica deploys need HMAC'd
    cursors; the SQLite/Redis follow-up handles it.
  - **`AuditStore.put` validation.** This PRP trusts the caller to pass
    an `AuditRowSchema`-valid object. The gate constructs it from typed
    fields; PRP 03's backend doesn't write. If a third writer appears,
    add a `parse()` at `put`.

  ## Anti-patterns

  - Don't expose the cursor as parseable JSON. A `JSON.stringify({ts,id})`
    cursor lets a caller forge a cross-tenant pivot. Use D1 or HMAC;
    nothing in between.
  - Don't accept `advertiserId` from a query string. In-memory trusts
    the caller; PRP 03's backend enforces session-sourced. If you find
    `req.query.advertiserId` anywhere, stop.
  - Don't allow `limit > 200`. Safety rail against demo foot-guns.
  - Don't sort by `ts` only. Same-ts rows skip/duplicate across pages.
  - Don't add a `query()` overload without `advertiserId`. D5 says you
    cannot ask for all rows; an overload defeats it.
  - Don't reintroduce the local `AuditRow` interface. PRP 01 is the
    single source.
  - Don't `console.log` the row. Log `{id, advertiserId, kind}` only.
  - Don't commit at red unless the message says `WIP — red`.

  ## Confidence: 8 / 10

  Greenfield methods on a stub-only `AuditStore`; the contract is fully
  specified in `features/clusterD/dashboard-verdict-views.md:26-40` and
  PRP 01 lands the discriminated-union row type. Two real risks: (1)
  PRP 01's exact field names for the `verdict` variant may differ from
  the names this PRP assumes — Task 1's gate migration is a one-line
  fix in either direction. (2) The cursor-token Map's 5-min eviction
  is a v1 simplification; if the demo leaves the dashboard open for
  hours, cursors expire and the frontend must refetch from page 1 —
  surface this in PRP 03's polling logic. Both risks are bounded and
  caught by the validation sweep.
