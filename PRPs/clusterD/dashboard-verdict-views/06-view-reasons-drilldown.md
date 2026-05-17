name: "Dashboard — PRP 06: ReasonsDrilldown view (TDD)"
description: |

  Sixth of seven PRPs implementing `features/clusterD/dashboard-verdict-views.md`.
  Lands the **ReasonsDrilldown** detail pane: `Reason[]` grouped by
  `kind`, the `PageProfile` snapshot, bid context, evidence tiles, and
  `disagreements[]` for `HUMAN_REVIEW` rows. Self-fetches via
  `useVerdictDetail`; returns `null` when no row is selected.

  ## TDD discipline

  Every task is **red → green → refactor** (cluster B precedent —
  `PRPs/clusterB/harness-contracts.md` §TDD discipline). A test that
  fails for the wrong reason is not a real red — fix the test first.
  Commit at green; one commit per red→green pair.

  ## Why this PRP exists separately

  PRP 05 ships the Timeline. The Drilldown's 5 children + 1 hook = 12
  new files don't fit in PRP 05 without busting the 300-line cap. Both
  PRPs consume the Timeline's `selectedVerdictId` singleton (PRP 05) and
  the backend's `GET /api/verdicts/:id` (PRP 03). With PRP 04 landed,
  05 and 06 run in parallel; this PRP only replaces the top-right
  `<aside>` placeholder slot in App.tsx.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A. Read-side; render is event-driven, not
    polled. Feature file line 9 excludes the dashboard from the gate's
    latency box.
  - **Pre-bid** — N/A. Verdict already returned before this renders.
  - **Plug-and-play** — Consumes `AuditRow` (PRP 01) and the API client
    (PRP 03). No `@scout/store` import (ESLint boundary
    `PRPs/foundation-ad-verification.md:155-156`), no `@scout/llm-client`.
  - **Sponsor tech (Track 1 — Veea)** — This view IS the "audit trail
    per verdict" claim from `features/architecture.md:77-78`. Reasons,
    profile, evidence, disagreements together are what a judge inspects
    to verify a verdict is auditable end-to-end. `lobstertrapTraceId`
    chip on the Timeline row (PRP 05) links here; this pane links to
    IntentDiff (PRP 07).

  ## CLAUDE.md rules that bite

  - § Working agreements — files ≤ ~300 lines. 5 components + 1 hook;
    no single file approaches the cap.
  - § Working agreements — 1 happy / 1 edge / 1 failure per file. Every
    component below exceeds the minimum because forward-compat branches
    (`HUMAN_REVIEW` empty, unknown `Reason.kind`, `profile === null`)
    are load-bearing for the demo.

  ## Decisions (locked here)

  | # | Question | Locked answer | Why |
  |---|---|---|---|
  | D1 | One file or split? | 5 components + 1 hook in `views/components/` + `views/hooks/`. | 300-line cap; independent test surfaces. |
  | D2 | Evidence URI encoding | RFC 4648 §5 base64url: `btoa(uri).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")`. | Plain base64 `/` breaks the route path; `=` breaks some routers. |
  | D3 | Evidence tile click | In-pane disclosure (WAI-ARIA) — toggle in place. NOT a modal. | No focus trap, no backdrop; preserves focus chain to Timeline row. |
  | D4 | Unknown `Reason.kind` | "Other" group; `console.warn` once per unknown kind. NEVER throw. | Forward-compat with future gate kinds; demo must not crash on additive deploy. |
  | D5 | `HUMAN_REVIEW` + empty `disagreements[]` | Literal "Confidence below threshold — see profile signals". | Step-3 below-threshold escalation (`features/clusterC/agent-arbiter-scoring.md:49`) produces this; empty list reads as broken. |
  | D6 | ProfileSnapshot scroll | Categories scroll if overflow (`max-height: 40vh; overflow-y: auto`); evidence grid does NOT (fixed 3×4, capped at 12 by arbiter per `agent-arbiter-scoring.md:65`). | Arbiter caps evidence; categories uncapped. |
  | D7 | ConfidenceBar | Hand-rolled CSS `<div style={{ width: clamped*100 + "%" }} />`. NO chart lib. | Feature file line 64 rejects charting deps in v1. |
  | D8 | Evidence proxy URL | `/api/evidence/${base64url(uri)}` — encoding client-side in `EvidenceTile`. | Single encoding source of truth; backend (PRP 03) decodes. |
  | D9 | Focus return on Escape | `useFocusReturn()` exported for PRP 05's keyboard wiring; this PRP does NOT install the Escape listener. | Disclosure pattern: invoker owns return; disclosed pane exposes the hook. |
  | D10 | `auditRow.profile === null` | ProfileSnapshot hidden entirely (no placeholder); reasons + bid context + disagreements still render. | DLQ-routed verdicts have no profile; reasons carry the explanation. |

  ## All Needed Context

  ```yaml
  - file: features/clusterD/dashboard-verdict-views.md
    section: "ReasonsDrilldown (line 19); drill-down rendered only when
      row selected (lines 56-60); profile + evidence shapes (lines 67-71);
      empty disagreements (line 168); bottom-right pane placement (170);
      no charting lib (172); evidence proxy + tenant isolation (84-85)"
    why: Source spec for every panel.

  - file: packages/shared/src/schemas/verdict.ts
    section: "ReasonSchema (lines 4-8); VerificationVerdictSchema (11-19)"
    why: Four known Reason.kind values (D4 forward-compat); decision
      discriminates HUMAN_REVIEW branch.

  - file: packages/shared/src/schemas/profile.ts
    section: "EvidenceRefSchema (16-20); PageProfileSchema (22-31)"
    why: Tile kind branch; categories/detectedEntities/evidenceRefs shape.

  - file: features/clusterC/agent-arbiter-scoring.md
    section: "Disagreement shape (27-31); below-threshold escalation (49);
      EVIDENCE_REF_CAP=12 (65)"
    why: perVerifier bar shape; D5 trigger; D6 grid sizing.

  - file: PRPs/clusterD/01-audit-and-intent-contracts.md
    why: AuditRow verdict variant — { id, kind, advertiserId, ts,
      request, verdict, profile, declaredIntent, detectedIntent }.

  - file: PRPs/clusterD/03-dashboard-backend-package.md
    why: GET /api/verdicts/:id → AuditRow | 404; GET /api/evidence/:b64url
      proxies bytes. useVerdictDetail / EvidenceTile consume.

  - file: PRPs/clusterD/04-dashboard-skeleton-and-app.md
    why: App.tsx three-pane layout; react-query provider configured.

  - file: PRPs/clusterD/05-view-verdict-timeline.md
    why: selectedVerdictId singleton; useFocusReturn() consumer.

  - url: https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/
    why: D3 — disclosure, not modal. No focus trap, no backdrop.
      Activation moves focus to disclosed heading; Escape returns.

  - url: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/img#loading
    why: <img loading="lazy"> — don't fetch 12 thumbnails on mount.

  - url: https://datatracker.ietf.org/doc/html/rfc4648#section-5
    why: D2 — base64url alphabet ('-' for '+', '_' for '/', no '='). 
  ```

  ## Files to create

  - `packages/dashboard/src/views/ReasonsDrilldown.tsx`
  - `packages/dashboard/src/views/ReasonsDrilldown.test.tsx`
  - `packages/dashboard/src/views/components/ReasonGroup.tsx`
  - `packages/dashboard/src/views/components/ReasonGroup.test.tsx`
  - `packages/dashboard/src/views/components/ProfileSnapshot.tsx`
  - `packages/dashboard/src/views/components/ProfileSnapshot.test.tsx`
  - `packages/dashboard/src/views/components/EvidenceTile.tsx`
  - `packages/dashboard/src/views/components/EvidenceTile.test.tsx`
  - `packages/dashboard/src/views/components/DisagreementsPanel.tsx`
  - `packages/dashboard/src/views/components/DisagreementsPanel.test.tsx`
  - `packages/dashboard/src/views/components/ConfidenceBar.tsx`
  - `packages/dashboard/src/views/components/ConfidenceBar.test.tsx`
  - `packages/dashboard/src/views/hooks/useVerdictDetail.ts`
  - `packages/dashboard/src/views/hooks/useVerdictDetail.test.ts`

  ## Files to modify

  - `packages/dashboard/src/App.tsx` — replace the top-right pane
    placeholder with `<ReasonsDrilldown />`. The component is mounted
    unconditionally; it returns `null` when no row is selected (the
    selection check lives inside the component, per D10 and the
    feature-file lines 56-60 "rendered only when a row is selected"
    rule).

  ## Target pseudocode (≤60 lines combined)

  ```tsx
  // ReasonsDrilldown.tsx
  export function ReasonsDrilldown(): JSX.Element | null {
    const id = useSelectedVerdictId(); // from PRP 05
    if (id === null) return null;
    const { data, isLoading, isError, refetch } = useVerdictDetail(id);
    if (isLoading) return <div role="status">Loading…</div>;
    if (isError || !data) return <ErrorBanner onRetry={refetch} />;
    if (data.kind !== "verdict") return null; // DLQ rows don't drill down here
    const grouped = groupReasonsByKind(data.verdict.reasons);
    return (
      <section aria-labelledby="drilldown-heading">
        <h2 id="drilldown-heading" ref={useFocusReturn().headingRef}>
          Verdict {data.id}
        </h2>
        {KNOWN_KINDS.concat(["Other"]).map((k) =>
          grouped[k]?.length ? <ReasonGroup key={k} kind={k} reasons={grouped[k]} /> : null,
        )}
        {data.profile && <ProfileSnapshot profile={data.profile} />}
        <BidContext request={data.request} />
        {data.verdict.decision === "HUMAN_REVIEW" && (
          <DisagreementsPanel
            disagreements={data.verdict /* read from arbiter audit field */}
          />
        )}
      </section>
    );
  }

  // EvidenceTile.tsx
  export function EvidenceTile({ ref }: { ref: EvidenceRef }): JSX.Element {
    const encoded = base64url(ref.uri);            // D2
    const src = `/api/evidence/${encoded}`;
    const [expanded, setExpanded] = useState(false);
    if (ref.kind === "dom_snippet") {
      const { text, error } = useEvidenceText(src);
      return (
        <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          <pre className={expanded ? "expanded" : "thumb"}>
            {error ? "[unavailable]" : text /* React escapes; safe vs <script>… */}
          </pre>
        </button>
      );
    }
    return (
      <button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <img loading="lazy" src={src} alt="" onError={onProxyError} />
      </button>
    );
  }
  ```

  ## Task order (TDD; commit-sized)

  Build leaf-up so each parent has green children. Every component
  goes red → green → refactor.

  ### Task 1 — ConfidenceBar

  Red: all five cases (0.5→50%; 0→0%; 1→100%; NaN→0% + warn; >1
  clamped). Green: `<div style={{ width: clamped*100 + "%" }} />` per
  D7. Refactor: extract `clampConfidence(v: number): number`.

  ### Task 2 — ReasonGroup

  Red: three reasons same kind → header count `3` + three rows; empty
  `reasons[]` → returns `null` (no empty header). Green: header + rows.

  ### Task 3 — EvidenceTile

  Red: (a) `kind:"screenshot"` → `<img loading="lazy"
  src="/api/evidence/<b64url>">`; (b) `kind:"dom_snippet"` → `<pre>`
  with proxied text (mock fetch); (c) proxy 404 → "[unavailable]"
  placeholder, NEVER raw URI; (d) `btoa("file:///tmp/x.png")`
  round-trips to base64url (no `+/=` in output). Green: branch on
  `ref.kind`; isolate `base64url(uri)` in `components/util/base64url.ts`.

  Security pin: an explicit test where the `dom_snippet` payload is
  `<script>alert(1)</script>` — assert no `<script>` tag in rendered
  DOM (React escapes text children; prevents future
  `dangerouslySetInnerHTML` regression).

  ### Task 4 — ProfileSnapshot

  Red: (a) `evidenceRefs.length===12` → 12 `EvidenceTile` instances;
  (b) `===3` → exactly 3, no padding, no truncation; (c) `===0` → "No
  evidence captured"; (d) `categories.length===50` → all rendered (no
  virtualization); (e) categories sorted descending by confidence
  (unsorted input; assert output order). Green: sorted categories,
  entity chips, grid.

  ### Task 5 — DisagreementsPanel

  Red: (a) single disagreement with three verifiers → three
  `ConfidenceBar` side-by-side, each labeled with verifier + confidence;
  (b) empty `disagreements` AND `decision==="HUMAN_REVIEW"` → exact
  text "Confidence below threshold — see profile signals" (D5); (c)
  `decision==="ALLOW"` → returns `null`.

  ### Task 6 — useVerdictDetail

  Red: (a) `id="v1"` → fires `GET /api/verdicts/v1` and returns row
  (MSW or fetch spy); (b) `id===null` → query disabled (zero fetches);
  (c) backend 404 → `isError===true` (cross-tenant case at consumer;
  PRP 03 covers at the route). Green: `useQuery` wrapper with
  `enabled: id !== null`.

  ### Task 7 — Drilldown root (happy + four-kind grouping)

  Red: fixture with all four `Reason.kind` values (one each); assert
  four group headers + counts correct; reasons appear under groups.
  Green: grouping + render loop.

  ### Task 8 — Drilldown root (profile branch + bid context)

  Red: (a) `profile != null` → ProfileSnapshot rendered, categories
  sorted, 12-tile grid; (b) `profile === null` → ProfileSnapshot
  hidden, reasons still render (D10); (c) BidContext shows
  `request.pageUrl`, `creativeRef`, `geo`.

  ### Task 9 — Drilldown root (forward-compat unknown kind)

  Red: fixture with `Reason.kind === "future_unknown_kind"` (forced
  `as any`) → "Other" group renders; `console.warn` fires once; no
  throw. Green: `KNOWN_KINDS` constant + "Other" bucket. Refactor:
  memoize warn via module-level `Set<string>`; assert a second render
  with the same unknown kind does NOT warn twice.

  ### Task 10 — Drilldown root (HUMAN_REVIEW + empty disagreements)

  Red: (a) `HUMAN_REVIEW` + one disagreement → panel visible, three
  bars (delegates to Task 5); (b) `HUMAN_REVIEW` + empty → exact
  fallback text per D5. Green: conditional render of panel for
  `HUMAN_REVIEW` only.

  ### Task 11 — Drilldown root (no-selection + error states)

  Red: (a) `selectedVerdictId===null` → returns `null`, DOM empty;
  (b) `useVerdictDetail` 500 → error banner visible, reasons hidden,
  "Retry" calls `refetch` (spy). Green: early-returns + error banner.

  ### Task 12 — Wire App.tsx slot

  Replace top-right `<aside>` placeholder with `<ReasonsDrilldown />`.
  PRP 04's App-level smoke test (iframe placement, Lobster Trap URL,
  three-pane layout) MUST remain green. Add: with `selectedVerdictId
  ===null`, top-right pane is the Drilldown's null branch (empty);
  with a selected id + mocked API response, reasons render.

  ### Task 13 — useFocusReturn export

  Thin hook exposing `{ headingRef, returnFocus }`. `headingRef`
  attaches to the Drilldown's `<h2>` and receives focus on mount
  (`useEffect` + `headingRef.current?.focus()`; `tabIndex={-1}` on
  heading). `returnFocus` is a no-op stub here; PRP 05 subscribes its
  Escape handler. Test: mount moves focus to heading
  (`document.activeElement`).

  ### Task 14 — Full validation sweep

  ```bash
  pnpm --filter @scout/dashboard test
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r build
  ```

  No new deps (all from PRP 04).

  ## Security guardrails

  - **Evidence proxied — never raw URI on wire.** EvidenceTile renders
    only `/api/evidence/<base64url(uri)>`. Test: a fixture URI
    `s3://internal-bucket/path/secret.png` MUST result in zero DOM
    references to `"s3://"` or `"internal-bucket"`.
  - **Thumbnails lazy-loaded.** `<img loading="lazy">` per MDN. Test:
    render 12-tile grid; every `<img>` carries `loading="lazy"`.
  - **`dom_snippet` as text in `<pre>`** — NEVER
    `dangerouslySetInnerHTML`. React escapes text children, so
    `</pre><script>alert(1)</script>` cannot escape. Task 3's pin
    asserts no `<script>` element in the tile subtree.
  - **`_lobstertrap.evidence` (PRP 01 intent schema) is text** — same
    protection if a future Drilldown variant renders it. Document in
    `ReasonsDrilldown.tsx` JSDoc.
  - **No raw URI in `<a href>`.** The disclosure trigger is a
    `<button>`, not an `<a>`. Test pins: no `<a href>` in the
    EvidenceTile subtree.
  - **No `process.env.*` in dashboard code** — per CLAUDE.md, no
    `VITE_*` holds a secret. Backend address comes from PRP 04's
    API client, not this view.

  ## Out of scope

  - **IntentDiff view** — PRP 07.
  - **Demo regression test** — PRP 07 (consumes the full five-scenario
    fixture set).
  - **URL deep-linking** (e.g., `?selectedVerdictId=v1`) — follow-up.
  - **Large evidence preview as a separate route** — follow-up. The
    in-pane disclosure is sufficient for the demo.
  - **Real-time updates to the Drilldown** while open — PRP 05 owns the
    Timeline polling; this PRP's `useVerdictDetail` does NOT poll
    (`staleTime: Infinity`, `refetchOnMount: false`). A verdict's
    reasons and profile do not change after the gate writes them.
  - **HUMAN_REVIEW resolution UI** — out of scope per feature file
    line 145.

  ## Anti-Patterns

  - Don't always-mount the Drilldown. It renders only when
    `selectedVerdictId !== null` — both for performance (no fetch when
    nothing selected) and for the disclosure-pattern semantics (the
    pane is the disclosed surface; the Timeline row is the disclosing
    control).
  - Don't add a chart library for ConfidenceBar. D7 locks CSS-only;
    the feature file rejects charting deps in v1.
  - Don't render evidence URIs as `<a href={uri}>` — even if the click
    is blocked, the URI leaks via right-click / view-source and reveals
    storage structure (bucket names, signed-URL parameters).
  - Don't pad `evidenceRefs` to 12 with empty placeholder tiles when
    fewer are present. Three refs → three tiles, no skeletons.
  - Don't `dangerouslySetInnerHTML` for `dom_snippet`. Use a `<pre>`
    with the text as a child; React's escaping is the XSS defense.
  - Don't make the Drilldown a focus-trap or a modal. It's a
    disclosure (D3) — no backdrop, no focus trap, no role="dialog".
  - Don't fetch in the Drilldown's `<h2>` ref callback. The fetch is
    `useVerdictDetail`'s job; the heading just receives focus.
  - Don't read `selectedVerdictId` via prop drilling. Use the singleton
    PRP 05 ships (zustand store or React context — whichever PRP 05
    locked).
  - Don't poll `useVerdictDetail`. Verdict rows are immutable once
    written by the gate (`features/clusterA/gate-verdict-logic.md:97`);
    polling here is wasted I/O.
  - Don't expand the disclosure into a route. Stay in-pane; routing is
    a follow-up.
  - Don't skip the red step on the security tests (no-`<script>` in
    snippet; no raw URI in DOM). Those are the tests most likely to
    silently regress; writing them red-first proves they catch the
    failure mode.

  ## Confidence: 8 / 10

  Mechanically straightforward: five leaf components with clear
  contracts, one hook, one root. The risk is PRP-05 coupling — the
  `selectedVerdictId` singleton and the `useFocusReturn` callback are
  contracts shared with PRP 05. If 05 lands first with a different
  state shape, this PRP adapts (one-line import change). If this PRP
  lands first, it ships a context-based singleton that PRP 05 can
  swap. The other open risk: the dom_snippet text-fetch path requires
  the proxy (PRP 03) to return `Content-Type: text/plain` for
  snippets vs. `image/*` for screenshots — verify on integration; if
  PRP 03 returns bytes uniformly, EvidenceTile sniffs by `EvidenceRef.kind`
  and reads the response body as text accordingly (no Content-Type
  reliance).
