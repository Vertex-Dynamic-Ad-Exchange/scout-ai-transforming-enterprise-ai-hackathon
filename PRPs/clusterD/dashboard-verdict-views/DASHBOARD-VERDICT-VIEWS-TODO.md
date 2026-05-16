# DASHBOARD-VERDICT-VIEWS-TODO.md

> Implementation tracker for `features/clusterD/dashboard-verdict-views.md`,
> split into 7 PRPs that land in strict dependency order. Each PRP is
> commit-sized, TDD-disciplined (red → green → refactor), and capped at
> ~400 lines so a single implementer can land it in one focused session.

## How to use this file

- **One PRP per session.** Pick the lowest-numbered `[ ]` row whose
  *Depends on* column is fully `[x]`.
- **Tick `[x]` only when the PRP's full validation gate passes**:
  `pnpm -r exec tsc --noEmit && pnpm -r test && pnpm -r build`. Type-checking
  alone is not enough — the TDD test suite the PRP itself adds must be
  green on `main` before you tick.
- **Use `[~]` while a PR is open** so a parallel session doesn't claim the
  same row. Add the branch name in parentheses.
- **Order is load-bearing.** Schemas (01) → store impl (02) → backend (03) →
  React skeleton (04) is a single chain; the three view PRPs (05, 06, 07)
  could be done in parallel after 04 lands, but 07's demo-regression test
  depends on 05 and 06 being green, so 07 is last regardless.

## Status legend

- `[ ]` PRP not started
- `[~]` PRP in progress on an open PR (note branch in parens)
- `[x]` PRP merged to `main`, validation gate passing

---

## PRPs (in order)

### Foundations — schemas + store + backend

- [ ] **`01-audit-and-intent-contracts.md`** — land
      `LobstertrapDeclaredIntentSchema` + `LobstertrapDetectedIntentSchema`
      in `packages/shared/src/schemas/intent.ts`, and `AuditRowSchema`
      (discriminated union over `kind: "verdict" | "profile_job_dlq"`)
      in `packages/shared/src/schemas/audit.ts`. Pure schema work; no
      runtime, no I/O. Foundational for every later row.
      *Depends on:* nothing.

- [ ] **`02-store-audit-read-interface.md`** — extend
      `packages/store/src/index.ts` `AuditStore` interface with `query()`
      + `get()` methods, refactor the existing local `AuditRow` type to
      consume `AuditRowSchema` from `@scout/shared`, and add a tenant-scoped
      in-memory impl with opaque cursor pagination. The contract test pins
      cross-tenant isolation at the store layer.
      *Depends on:* `[x] 01`.

- [ ] **`03-dashboard-backend-package.md`** — new `@scout/dashboard-backend`
      Fastify ESM package with three routes: `GET /api/verdicts`,
      `GET /api/verdicts/:id`, `GET /api/evidence/:uri`. Stub-auth via
      `x-advertiser-id` header preHandler; cross-tenant requests return
      404 (not 403); evidence proxy streams bytes (`reply.raw.pipe()`),
      validates URI ownership; `ETag` / `If-None-Match` → 304 on the list
      endpoint. Read-only seam enforced by a `vi.spyOn(auditStore, "put")`
      assertion of zero calls.
      *Depends on:* `[x] 02`.

### Dashboard skeleton

- [ ] **`04-dashboard-skeleton-and-app.md`** — replace
      `packages/dashboard/src/index.ts` (`export {};`) with a Vite + React
      skeleton: `App.tsx` three-pane layout (40% left, 40%×60% top-right,
      40%×40% bottom-right), Lobster Trap iframe sourced from
      `VITE_LOBSTERTRAP_URL` (sandbox `allow-same-origin allow-scripts`,
      no `allow-top-navigation`), iframe `onLoad` skeleton + `onError`
      fallback link, `theme.ts` with WCAG 2.1 AA palette,
      `fixtures/demoScenarios.ts` placeholder, React Query `QueryClient`
      with `staleTime: 500ms`. Two security tests: (a) ESLint boundary
      asserts `dashboard/` cannot import `@scout/store` /
      `@scout/llm-client`; (b) post-`vite build` bundle-grep asserts no
      string match for `GEMINI_API_KEY` / `OPENAI_API_KEY` in `dist/`.
      *Depends on:* `[x] 03`.

### Views — read-only over the backend

- [ ] **`05-view-verdict-timeline.md`** — `VerdictTimeline.tsx`
      virtualized timeline (`@tanstack/react-virtual`, fixed-height rows,
      no URL wrap). Decision badges with **color + icon + text** (no
      color-only differentiation). Polling at 1s via `@tanstack/react-query`,
      paused on `document.visibilityState === "hidden"`, debounced 250ms
      on resume. `If-None-Match` → 304 yields no re-render. Tab toggle
      `kind=verdict` ↔ `kind=profile_job_dlq`. Five tests: happy /
      empty / failure / virtualization perf (1000 rows, <16ms/frame) /
      keyboard nav (Tab → Enter opens drilldown → Escape returns focus).
      *Depends on:* `[x] 04`.

- [ ] **`06-view-reasons-drilldown.md`** — `ReasonsDrilldown.tsx` detail
      pane. `Reason[]` grouped by `Reason.kind` (4 known kinds + "Other"
      forward-compat group with `console.warn`, never throws). Profile
      snapshot panel: sorted `categories[]` with hand-rolled CSS confidence
      bars, `detectedEntities[]` chips, `evidenceRefs[]` 3×4 grid (sized
      to `EVIDENCE_REF_CAP = 12` so no client truncation). Evidence tiles
      branched on `EvidenceRef.kind` (`screenshot` / `dom_snippet` /
      `video_frame`), thumbnails lazy-loaded via the backend's
      `/api/evidence/:uri` proxy. `HUMAN_REVIEW` variant surfaces
      `disagreements[]` with `perVerifier` bar chart over `text | image |
      video`; empty `disagreements[]` renders "Confidence below threshold —
      see profile signals", never an empty list.
      *Depends on:* `[x] 04` (for App layout integration; can run in
      parallel with `05`).

- [ ] **`07-view-intent-diff-and-demo-regression.md`** — `IntentDiff.tsx`
      two-column declared-vs-detected diff (the Veea-Award showpiece).
      Left column: `_lobstertrap` declared intent. Right column: detected
      intent from the Lobster Trap audit row (looked up by
      `lobstertrapTraceId`). Centered between: divergence highlighted in
      amber **with a screen-reader-readable explanation** (text, not
      color-only). Plus `App.demo.test.tsx` regression: render `App` with
      a `MockAuditClient` seeded with the five demo scenarios from
      `FEATURE-TODO.md:84-89` (clean ALLOW, clean DENY, ambiguous Flash
      escalation, HUMAN_REVIEW arbiter disagreement, cache-miss DENY-then-
      warm), assert decision badges + tab navigation + `axe-core` AA
      audit zero violations. The five fixtures land in
      `packages/dashboard/src/fixtures/demoScenarios.ts` and are the same
      shape `demo-bidstream-seeding.md` will produce at runtime.
      *Depends on:* `[x] 05` AND `[x] 06`.

---

## Cross-cutting validation (must hold across the whole feature)

- [ ] **Tenant isolation, end-to-end.** Pinned at the store layer in `02`
      and at the route layer in `03`. The `App.demo.test.tsx` regression
      in `07` does not retest tenancy (it runs against a single advertiser
      session) — tenancy is a backend concern, not a view concern.
- [ ] **No-secrets-in-bundle.** Pinned by `04`'s bundle-grep test.
      Must stay green after `05`, `06`, `07` add view code.
- [ ] **Lobster Trap iframe trace continuity.** `IntentDiff` in `07`
      relies on `lobstertrapTraceId` being non-null on Flash-escalation
      verdicts; this is the contract `gate-verdict-logic.md` already lands.
      If a future gate change writes `null` for an escalated verdict, the
      `07` demo-regression test fails (intentionally — surface the bug).

## Update protocol

When a PRP merges, tick its row, append the merge commit short-SHA in
parens, and update *Depends on* notes downstream if anything shifted.
Keep this file under ~150 lines; if it grows beyond, the right action
is to mark some rows stale or move them to a closed-rows section, not
to widen the file.
