name: "Dashboard — PRP 07: IntentDiff view + five-scenario demo regression + axe AA audit (TDD)"
description: |

  Seventh and **final** PRP for `features/clusterD/dashboard-verdict-views.md`.
  Lands the **IntentDiff** view — the Veea-Award showpiece — the
  **five-scenario demo regression suite**, and the **axe-core WCAG 2.1 AA**
  accessibility audit. After this PRP merges, every claim in the feature
  file's *Demo stakes* section (lines 5-7) is substantiated on stage.

  ## TDD discipline

  Every task is **red → green → refactor** (cluster B precedent —
  `PRPs/clusterB/harness-contracts.md` §TDD discipline). A test that fails
  for the wrong reason is not a real red — fix the test first. Commit at
  green; one commit per red→green pair. WIP commits only at red with
  message prefix `WIP — red`.

  ## Why this PRP exists separately

  IntentDiff alone is small (one view + one leaf component) but pairs
  naturally with the demo regression: the regression test renders the full
  `<App />` and asserts the showpiece HUMAN_REVIEW row surfaces the
  divergence callout. That assertion requires IntentDiff to be present in
  the App tree. Likewise the axe-core AA audit can only meaningfully run
  once **all three views** (Timeline from PRP 05, Drilldown from PRP 06,
  IntentDiff from this PRP) are mounted together — a per-view audit
  misses cross-view contrast/landmark interactions. Splitting into a 7th
  PRP also keeps each file under the 300-line cap and gives the
  showpiece moment its own commit-trail for demo-rehearsal review.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A. Read-side; IntentDiff renders on row
    selection, not polled. Feature file line 9 excludes the dashboard
    from the gate's latency box.
  - **Pre-bid** — N/A. Verdict already returned to the bidder before
    this view ever paints.
  - **Plug-and-play** — Consumes only `AuditRow` (PRP 01) via the API
    client (PRP 03). The diff fields (`declaredIntent`, `detectedIntent`)
    are nullable; the view degrades to an empty-state panel when LT data
    is absent, so the dashboard survives a Lobster Trap outage without a
    crash or a deploy.
  - **Sponsor tech (Track 1 — Veea)** — **This view IS the Veea-Award
    showpiece** (feature file lines 6-7). The "would have leaked an
    ALLOW; Lobster Trap caught it" moment is the HUMAN_REVIEW scenario
    (#4 below) rendering an amber divergence callout with a
    screen-reader-readable explanation. Without this PRP the narrative
    has no UI; the iframe alone does not surface the *declared-vs-detected*
    contrast in the same row as our verdict.

  ## CLAUDE.md rules that bite

  - § Working agreements — files ≤ ~300 lines. IntentDiff is split from
    DivergenceCallout for this reason; each well under the cap.
  - § Working agreements — 1 happy / 1 edge / 1 failure per new file.
    Met; IntentDiff exceeds because the showpiece behavior is
    load-bearing for the demo.
  - § Working agreements — **for security-touching code, state
    assumptions explicitly**. The showpiece assumes a specific LT
    divergence shape (`detectedIntent.divergence: string | null`); the
    fallback when LT is absent (`declaredIntent === null`) is
    intentional v1 behavior — documented in *Decisions* and *Security
    guardrails*, not a bug.
  - § Working agreements — **no secrets in client/UI code**. The
    fixture data in `demoScenarios.ts` is fully synthesized — no real
    Gemini responses, no real LT trace IDs, no real advertiser data.
    Documented in *Security guardrails*.

  ## Decisions (locked here)

  | # | Question | Locked answer | Why |
  |---|---|---|---|
  | D1 | Divergence rendering | Plain text via React children (auto-escaped). **NEVER** `dangerouslySetInnerHTML`. | XSS surface; LT-sourced text is untrusted. |
  | D2 | Amber color | `#fef3c7` background (Tailwind amber-100) + `#78350f` text (amber-900). WCAG AA verified — contrast ratio 11.2:1 on amber-100. | Color-blind-safe pairing; survives projector. |
  | D3 | Divergence signal | Color AND heading text AND body text — NEVER color-only. Heading literal: `"Intent divergence detected"`. | WCAG 1.4.1 (Use of Color); screen-reader-readable. Literal pinned so the test does not drift. |
  | D4 | Empty divergence string | `""` treated as no divergence (renders green aligned badge, NOT amber). | Defends against truthy-empty bugs upstream. |
  | D5 | Tab state location | Extend PRP 05's `selectedVerdict` singleton with a `selectedTab: "iframe" \| "intent_diff"` slice. NOT a new store. | One singleton for selection-related state; matches PRP 05's pattern. |
  | D6 | Iframe vs IntentDiff toggle | CSS visibility (`hidden` attribute) — **NOT** unmount. | Preserves iframe load state (~500ms cold-load per feature file line 172). |
  | D7 | axe rule set | `wcag2a`, `wcag2aa`. NOT `wcag2aaa`. | Feature file line 173 + WCAG 2.1 AA is the explicit bar. |
  | D8 | axe palette false positives | Document in `theme.ts` JSDoc with WCAG citation; **NEVER** silence the rule globally. | Feature file Gotcha line 173. |
  | D9 | Demo fixtures | Deterministic literals in `fixtures/demoScenarios.ts`. NO `Math.random`. | Reproducible test runs; same fixture feeds `demo-bidstream-seeding.md` replayer. |
  | D10 | MockAuditClient location | Separate file `src/api/MockAuditClient.ts`. NOT inlined in test. NOT exported from runtime barrel. | Reusable by PRPs 05/06 visual smoke tests later (out of scope here). |
  | D11 | Divergence string source | Inline in component / `messages.ts` constants file. NOT in `theme.ts`. | `theme.ts` is theme, not content. |
  | D12 | Showpiece literal | `"Intent divergence detected"` pinned in `messages.ts`. | Single source of truth; the App.demo test imports it instead of duplicating. |

  ## All Needed Context

  ```yaml
  - file: features/clusterD/dashboard-verdict-views.md
    section: "PRIORITY — Demo stakes (lines 5-7);
      FEATURE — IntentDiff (lines 20-23);
      App layout — bottom-right tab toggle (line 24);
      Tests (C) — five-scenario regression (line 55);
      EXAMPLES — Decision palette + axe AA (lines 71-74);
      lobstertrapTraceId chip-presence dial (line 67);
      EXAMPLES — disagreements perVerifier (lines 83-86);
      OTHER CONSIDERATIONS — Policy.declaredIntent follow-up (lines 121-122);
      Gotcha — axe palette false positives (line 173);
      Test order — IntentDiff happy + showpiece + App.demo (lines 186-187)"
    why: Source spec for every assertion below.

  - file: features/clusterD/demo-bidstream-seeding.md
    why: The runtime replayer that consumes the SAME `fixtures/demoScenarios.ts`
      file this PRP fills. Coordinate field shapes — one fixture file, two
      consumers (dashboard test + replayer).

  - file: FEATURE-TODO.md
    section: "Lines 84-89 — the canonical five-scenario demo list"
    why: Cluster D — Surface area & demo row pins exactly the five scenarios
      this PRP's fixture file must contain.

  - file: PRPs/clusterD/01-audit-and-intent-contracts.md
    why: LobstertrapDeclaredIntentSchema + LobstertrapDetectedIntentSchema
      + AuditRowSchema land here. IntentDiff reads `auditRow.declaredIntent`
      / `auditRow.detectedIntent`; the test fixtures must pass
      `AuditRowSchema.parse()`.

  - file: PRPs/clusterD/04-dashboard-skeleton-and-app.md
    why: Ships `fixtures/demoScenarios.ts` as a typed placeholder
      (`export const DEMO_SCENARIOS: DemoScenario[] = [];`). This PRP fills
      the array. Also ships axe-core + vitest-axe deps — NO new deps here.

  - file: PRPs/clusterD/05-view-verdict-timeline.md
    why: `selectedVerdict` singleton store this PRP extends with
      `selectedTab` slice. Timeline's keyboard tab order + row Enter/Escape
      already wired — App.demo test asserts the existing behavior, does not
      re-wire it.

  - file: PRPs/clusterD/06-view-reasons-drilldown.md
    why: Drilldown's `useVerdictDetail` hook is reused by IntentDiff —
      single fetch per selection, react-query dedupes the cache key.

  - file: packages/shared/src/schemas/verdict.ts
    why: `lobstertrapTraceId: z.string().nullable()` — null means no LLM
      call this verdict; IntentDiff returns null in that case (no diff).

  - file: packages/shared/src/schemas/profile.ts
    why: Drilldown consumes; IntentDiff does NOT — diff is over intent
      schemas (PRP 01), not profile.

  - url: https://github.com/dequelabs/axe-core/blob/develop/doc/API.md
    why: `axe.run(node, { runOnly: { type: "tag", values: ["wcag2a","wcag2aa"] } })`
      — vitest-axe wrapper exposes `toHaveNoViolations()` matcher.

  - url: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum
    why: AA contrast = 4.5:1 normal text, 3:1 large text. Amber palette
      (D2) cited against this.

  - url: https://www.w3.org/WAI/WCAG21/Understanding/use-of-color
    why: 1.4.1 — divergence cannot be color-only; D3 enforces.
  ```

  ## Files to create

  - `packages/dashboard/src/views/IntentDiff.tsx`
  - `packages/dashboard/src/views/IntentDiff.test.tsx`
  - `packages/dashboard/src/views/components/DivergenceCallout.tsx`
  - `packages/dashboard/src/views/components/DivergenceCallout.test.tsx`
  - `packages/dashboard/src/views/messages.ts` (1-2 exported string constants — pinned literals for D3/D12)
  - `packages/dashboard/src/api/MockAuditClient.ts`
  - `packages/dashboard/src/api/MockAuditClient.test.ts`
  - `packages/dashboard/src/App.demo.test.tsx`

  ## Files to modify

  - `packages/dashboard/src/App.tsx` — add a tab switcher in the
    bottom-right pane: `selectedTab === "iframe"` shows the existing
    iframe (visible); `selectedTab === "intent_diff"` shows `<IntentDiff />`.
    BOTH mount always; toggle is the `hidden` attribute (D6).
  - `packages/dashboard/src/views/state/selectedVerdict.ts` (from PRP 05) —
    add a `selectedTab: "iframe" | "intent_diff"` slice with a
    `setSelectedTab(tab)` action. Default `"iframe"` (iframe visible on
    initial mount; user opts into IntentDiff). `selectedTab` survives
    row-selection changes (does NOT reset when `selectedVerdictId`
    changes).
  - `packages/dashboard/src/fixtures/demoScenarios.ts` — fill the empty
    array PRP 04 landed with the five scenarios below. Type alias
    (`DemoScenario`) unchanged.

  ## Five demo scenarios (literal field values)

  Per `FEATURE-TODO.md:84-89`. All fixtures pass `AuditRowSchema.parse()`
  (PRP 01) — test asserts this.

  1. **Clean ALLOW** — `verdict.decision: "ALLOW"`,
     `verdict.reasons: [{ kind: "policy_rule", ref: "rule.allow.fashion", detail: "Page profile matches advertiser allow list" }]`,
     `lobstertrapTraceId: "trace-001"`, `declaredIntent` + `detectedIntent`
     populated with `divergence: null`.
  2. **Clean DENY** — `verdict.decision: "DENY"`,
     `verdict.reasons: [{ kind: "policy_rule", ref: "rule.deny.alcohol", detail: "Page profile matches advertiser deny list" }]`,
     `lobstertrapTraceId: "trace-002"`, aligned intents (`divergence: null`).
  3. **Ambiguous Flash escalation** — `verdict.decision: "DENY"`,
     `verdict.reasons: [{ kind: "fail_closed", ref: "flash.escalation", detail: "Gate Flash escalation returned DENY for ambiguous category" }]`,
     `lobstertrapTraceId: "trace-003"`, `divergence: null`.
  4. **HUMAN_REVIEW arbiter disagreement (SHOWPIECE)** —
     `verdict.decision: "HUMAN_REVIEW"`,
     `verdict.reasons: [{ kind: "arbiter_disagreement", ref: "arbiter.text-vs-image", detail: "Text classifier said safe, image classifier said unsafe" }]`,
     `disagreements: [{ kind: "category", label: "alcohol", perVerifier: { text: 0.15, image: 0.92, video: 0.30 } }]`,
     `lobstertrapTraceId: "trace-004"`,
     `detectedIntent.divergence: "Detected scope expanded beyond declared classification — image verifier prompt may have been jailbroken by overlay text"`.
  5. **Cache-miss DENY-then-warm** — two rows:
     - Row A (earlier ts): `decision: "DENY"`,
       `reasons: [{ kind: "fail_closed", ref: "cache.miss", detail: "Profile not yet warm; failing closed pending profiler completion" }]`,
       `lobstertrapTraceId: null` (no LLM this verdict).
     - Row B (later ts): `decision: "ALLOW"`,
       `reasons: [{ kind: "policy_rule", ref: "rule.allow.tech", detail: "Profile warmed; matches allow list" }]`,
       `lobstertrapTraceId: "trace-005"`.
     Timeline asserts both rows present; Row A's IntentDiff returns
     `null` (no trace id → no diff).

  Fixtures exported as `export type DemoScenario = { name: string; row: AuditRow }; export const DEMO_SCENARIOS: DemoScenario[]` (6 entries — scenario #5 produces 2 rows).

  ## Target pseudocode (≤50 lines combined)

  ```tsx
  // DivergenceCallout.tsx
  import { DIVERGENCE_HEADING } from "../messages.js";
  export function DivergenceCallout({ divergence }: { divergence: string | null }) {
    if (!divergence) {  // null OR "" — D4
      return <div role="status" className="badge-aligned">
        ✓ Declared and detected intent aligned
      </div>;
    }
    return <aside role="alert" className="callout-amber">
      <h3>⚠ {DIVERGENCE_HEADING}</h3>
      <p>{divergence}</p>  {/* React auto-escapes — D1 */}
    </aside>;
  }

  // IntentDiff.tsx
  export function IntentDiff(): JSX.Element | null {
    const { selectedVerdictId } = useSelectedVerdict();
    const { data: row, error } = useVerdictDetail(selectedVerdictId);
    if (!selectedVerdictId) return null;
    if (error) return <ErrorBanner />;
    if (!row || row.kind !== "verdict") return null;
    if (row.verdict.lobstertrapTraceId === null) return null;
    if (row.declaredIntent === null) return <EmptyDeclared />;
    return <section aria-label="Intent diff">
      <DeclaredColumn intent={row.declaredIntent} />
      <DivergenceCallout divergence={row.detectedIntent?.divergence ?? null} />
      {row.detectedIntent
        ? <DetectedColumn intent={row.detectedIntent} />
        : <DetectedMissing />}
    </section>;
  }
  ```

  ## Task order (TDD; commit-sized)

  1. **Red→Green** — extend `selectedVerdict` store with `selectedTab` slice
     + `setSelectedTab(tab)` action; default `"iframe"`. Test: setting
     tab does not reset `selectedVerdictId`; setting verdict does not
     reset tab.
  2. **Red→Green** — `messages.ts` exports `DIVERGENCE_HEADING = "Intent
     divergence detected"`. Trivial; pins literal so D3/D12 do not drift.
  3. **Red→Green** — `DivergenceCallout.test.tsx`: happy (amber + heading
     + body), edge (`null` → green aligned), failure (`""` → green
     aligned, NOT amber).
  4. **Red→Green** — `DivergenceCallout.tsx` impl per pseudocode.
  5. **Red→Green** — `IntentDiff.test.tsx`: aligned intents → green
     badge, no amber.
  6. **Red→Green** — `IntentDiff.test.tsx`: showpiece — `divergence:
     "Detected scope expanded..."` → amber callout AND
     `getByRole("heading", { name: /intent divergence/i })` present.
  7. **Red→Green** — `IntentDiff.test.tsx`: edges (`lobstertrapTraceId:
     null` → returns `null`; `declaredIntent: null` → empty-state panel);
     failure (`useVerdictDetail` 500 → error banner).
  8. **Red→Green** — `IntentDiff.tsx` impl per pseudocode.
  9. **Red→Green** — fill `fixtures/demoScenarios.ts` with the 5
     scenarios (6 rows); assert every row passes `AuditRowSchema.parse()`
     in a colocated test.
  10. **Red→Green** — `MockAuditClient.ts` + `.test.ts`: `query()` returns
      seeded scenarios reverse-chronological; `get(id)` returns single
      match; `query({ kind: "profile_job_dlq" })` returns `[]`;
      `get("nonexistent")` returns `null` (NOT throws).
  11. **Red→Green** — wire `App.tsx`: tab switcher in bottom-right pane;
      iframe + IntentDiff both mount; `hidden` attribute toggles.
  12. **Red→Green** — `App.demo.test.tsx`: 5 `describe` blocks (one per
      scenario), each asserting (1) badge color+icon+text, (2) tab
      Enter/Escape focus behavior, (3) iframe coexistence (present in
      DOM after tab toggle). HUMAN_REVIEW block additionally clicks the
      "Intent Diff" tab and asserts the divergence heading is visible.
  13. **Red→Green** — outer `describe("axe AA audit")` block: render all
      5 scenarios in sequence, run `axe.run(container, { runOnly: { type:
      "tag", values: ["wcag2a","wcag2aa"] } })`, assert zero violations.
      Document any palette-related false positive in `theme.ts` JSDoc per
      D8 — do NOT globally silence.
  14. **Final sweep** — run full validation gates below; cap-check
      (`wc -l`) every new file ≤ 300 lines.

  ## Security guardrails

  - **No `dangerouslySetInnerHTML`** anywhere in IntentDiff or
    DivergenceCallout. Divergence text comes from Lobster Trap audit
    rows — untrusted. React's auto-escape is the only renderer. Pin
    with a test: include `<script>alert(1)</script>` in a divergence
    fixture string; assert `container.querySelector("script") === null`.
  - **Fixture data is intentionally fake.** No real Gemini responses,
    no real LT trace IDs, no real advertiser IDs, no real evidence
    URIs. Documented at the top of `fixtures/demoScenarios.ts` in a
    JSDoc block.
  - **`MockAuditClient` is test-only** — NOT exported from the
    `packages/dashboard` runtime barrel. Either (a) place under a
    `src/api/__test-utils__/` directory the barrel ignores, or (b) add
    a `vitest.config.ts` alias that maps test imports to the file
    while production builds error on the import. Test asserts the
    built `dist/` does NOT contain the `MockAuditClient` symbol (grep
    the bundle from PRP 04's bundle-grep test infrastructure).
  - **axe AA enforces minimum contrast** — protects against ad-hoc
    palette edits silently breaking accessibility.
  - **`Policy.declaredIntent` schema extension assumption** — until the
    follow-up to `policy-match-evaluation.md` (feature file line 122)
    lands, `auditRow.declaredIntent` may be `null` in production. The
    empty-state panel "Declared intent not authored yet" is the
    documented v1 fallback. NOT a bug; pinned in
    `IntentDiff.test.tsx` as an explicit edge case.
  - **No secrets in client** — confirmed; this PRP introduces no env
    var reads, no API keys, no policy bodies on the wire.

  ## Out of scope (file as follow-ups)

  - Real Lobster Trap integration write path (gate's concern — see
    `features/clusterA/gate-verdict-logic.md`; this PRP only renders
    what the gate writes).
  - URL deep-linking to a specific scenario (`?scenario=human_review`).
  - PDF export of the diff for offline judge review.
  - Multi-verdict side-by-side comparison view — file as
    `features/clusterD/dashboard-multi-verdict-diff.md`.
  - Real OIDC auth — already filed as `dashboard-auth.md` per feature
    file line 148.
  - The actual `Policy.declaredIntent` schema extension on the policy
    side — already filed as a follow-up to `policy-match-evaluation.md`
    per feature file line 122. Until it lands, IntentDiff degrades
    gracefully (empty-state panel — covered by Task 7).
  - Retrofitting PRPs 05/06 to use `MockAuditClient` for their own
    visual smoke tests (the mock is reusable, but those PRPs already
    landed with their own fixtures; retrofitting is a clean-up follow-up).

  ## Anti-patterns

  - ❌ Don't use `dangerouslySetInnerHTML` for divergence text — XSS
    surface; React auto-escape is the only renderer.
  - ❌ Don't render divergence as color-only — must include heading
    text AND body text (D3 / WCAG 1.4.1).
  - ❌ Don't unmount the iframe when toggling tabs — preserves the
    ~500ms cold-load state (D6 / feature file line 172).
  - ❌ Don't fake-pass the axe AA audit by silencing rules globally —
    document any palette false positive in `theme.ts` JSDoc with WCAG
    citation per D8 / feature file line 173.
  - ❌ Don't randomize fixture data (`Math.random`, `Date.now()` in
    scenario timestamps) — tests must be deterministic; use ISO-8601
    literals.
  - ❌ Don't import `MockAuditClient` from the runtime barrel — keeps
    test-only code out of `dist/`.
  - ❌ Don't put the showpiece divergence string in `theme.ts` — it's
    content, not theme; lives in `messages.ts` (D11).
  - ❌ Don't reset `selectedTab` when `selectedVerdictId` changes —
    feature file line 24 implies the tab is a pane-level preference,
    not a per-verdict one.
  - ❌ Don't widen the axe rule set to `wcag2aaa` — feature file
    explicitly targets AA (D7).
  - ❌ Don't commit at red unless message is `WIP — red`.

  ## Validation gates

  ```bash
  pnpm --filter @scout/dashboard test
  pnpm --filter @scout/dashboard test -- App.demo
  pnpm --filter @scout/dashboard build
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r build
  pnpm audit
  ```

  Bundle-grep test from PRP 04 must still pass (no `GEMINI_API_KEY` /
  `OPENAI_API_KEY` / `MockAuditClient` symbol in `dist/`). All five
  scenarios render without axe AA violations. Every new file ≤ 300 lines.

  ## Confidence: 8 / 10

  IntentDiff itself is a small two-column read-only render; risk is low.
  The two points that knock 2 off:
  (1) **Showpiece dependency on PRP 01's intent schemas** — if PRP 01's
  `LobstertrapDetectedIntentSchema` lands `divergence` as a non-string
  shape (e.g., a structured object instead of a string), this PRP's
  pseudocode + `messages.ts` literal need a minor rework; mitigated by
  the App.demo regression catching it at green time.
  (2) **axe-core projector-palette false positives** — feature file
  Gotcha line 173 flags this; the documented-in-`theme.ts` workaround
  is correct but adds friction if the palette needs more than one
  citation. Plausibly a one-task slip, not a blocker.
