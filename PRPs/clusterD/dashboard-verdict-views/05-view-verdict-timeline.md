name: "Dashboard — PRP-05: `VerdictTimeline` view + polling/visibility/ETag plumbing (TDD)"
description: |

  Fifth of seven PRPs implementing `features/clusterD/dashboard-verdict-views.md`.
  Lands the **left-pane timeline** — virtualized, 1s-polled, visibility-aware,
  ETag-conditional. Extracts `DecisionBadge`, `useVerdictsQuery`, and a tiny
  `selectedVerdict` singleton so PRP 06 (ReasonsDrilldown) and PRP 07
  (IntentDiff + demo regression) can land in parallel against the same seams.

  ## TDD discipline

  Every task is **red → green → refactor**, per
  `PRPs/clusterB/harness-contracts.md` lines 10-33:

  1. **Red.** Write the test first. Run it. Confirm it fails for the
     *expected reason* (missing export, missing element, wrong call count).
     A test that fails on a typo is not a real red — fix the test.
  2. **Green.** Minimum impl to flip green. Resist adding fields the
     test doesn't exercise.
  3. **Refactor.** Tidy, `tsc --noEmit`, `eslint --fix`. Tests stay green.

  Commit at green (one commit per red→green pair). Never commit at red
  unless the message is `WIP — red`.

  ## Why this PRP exists separately

  - **Timeline is the largest view** and the only virtualized one; the
    perf gate is meaningful here and nowhere else.
  - **Unblocks 06 + 07 in parallel.** Once `selectedVerdict` singleton
    + `useVerdictsQuery` + `DecisionBadge` land, PRP 06 consumes
    `useSelectedVerdictId()` and PRP 07 reuses `DecisionBadge` in
    IntentDiff and the demo regression. Without this PRP, both
    downstream PRPs would duplicate the seam or block on each other.
  - **App.tsx wiring is trivial.** Swap the left-pane placeholder
    foundation task 8 lands; other panes remain stubs until 06 / 07.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A. Read-side of the async audit log; budget
    is *"renders 100 verdicts without jank"* (feature file lines 56-60).
  - **Pre-bid** — N/A; off the gate's hot path.
  - **Plug-and-play** — Consumes `AuditRow` from `@scout/shared` + the
    PRP-04 API client. No `@scout/store` / `@scout/llm-client` import
    — preserved by foundation ESLint boundary (`PRPs/foundation-ad-verification.md`
    lines 155-156).
  - **Sponsor tech** — Track 1 (Veea). Lands the navigation entry that
    routes selection to the Veea-audit-linked detail panes (06 / 07).

  ## CLAUDE.md rules that bite

  - **300-line file cap** drives the split: `DecisionBadge.tsx`,
    `useVerdictsQuery.ts`, `selectedVerdict.ts` each separate.
    `VerdictTimeline.tsx` ≤200 lines incl. JSX.
  - **1 happy / 1 edge / 1 failure minimum** — exceeded on every file;
    UI surfaces are load-bearing for the demo.
  - **No secrets in client** — no `VITE_*` introduced here.

  ## Decisions (locked here)

  | # | Question | Locked answer | Why |
  |---|---|---|---|
  | D1 | Row height (virtualization estimation) | 56 px fixed | One-line URL via ellipsis + 24px badge + 12px×2 padding; variable rows break `@tanstack/react-virtual`. Feature file line 167. |
  | D2 | Virtualization overscan | 5 rows | Default; tuned only if perf test fails. |
  | D3 | Polling cadence | 1000 ms | Feature file line 113. |
  | D4 | Visibility debounce | 250 ms | Feature file line 168. |
  | D5 | `staleTime` | 500 ms | Deduplicates re-render-triggered refetches against the 1s cadence. Feature file line 166. |
  | D6 | Tab-toggle state location | Component-local `useState` | Feature file line 81: *"Tab toggle is one piece of state, not a route."* No URL param. |
  | D7 | Keyboard nav contract | Tab → row gains focus; Enter → select; Escape → blur back to container | Feature file lines 55, 167-168, WAI-ARIA disclosure pattern. |
  | D8 | Empty vs. failure distinction | Two separate `data-testid`s: `timeline-empty`, `timeline-error` | Feature file line 171: empty ≠ fetch failed. Two tests. |
  | D9 | Cross-PRP state sharing | `useSyncExternalStore` against a module-singleton (no zustand, no context) | No new deps; tiny surface; trivially testable. |
  | D10 | `pageUrl` rendering | Plain text, not an anchor | Anti-XSS in v1; clickable URLs filed as follow-up. |
  | D11 | `refetchOnMount` | `false` | Feature file line 166: avoids stampede on remount given `staleTime: 500`. |
  | D12 | `setInterval` location | React Query owns it; component never calls `setInterval` | Single source of cadence truth. |

  ## All Needed Context

  ```yaml
  - file: features/clusterD/dashboard-verdict-views.md
    section: "18 (row shape), 46 (polling), 56-60 (perf + 304),
      80-82 (DLQ tab), 113-116 (real-time decision),
      167-168 (virtualization + debounce), 170-172 (empty vs failure),
      180-187 (test order)"
  - file: packages/shared/src/schemas/verdict.ts
    why: `VerificationVerdictSchema` — decision, latencyMs, policyVersion,
      nullable lobstertrapTraceId (chip presence).
  - file: packages/shared/src/schemas/primitives.ts
    why: `DecisionSchema` enum narrows `DecisionBadge`; drives the
      unknown-fallback test.
  - file: packages/shared/src/schemas/profile.ts
    why: PRP 06 territory; referenced for `AuditRow.verdict.profile`.
  - url: https://tanstack.com/virtual/latest/docs/framework/react/react-virtual
    why: `useVirtualizer({ estimateSize: () => 56, overscan: 5 })` +
      `measureElement` jsdom override.
  - url: https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching
    why: `refetchInterval`, `refetchOnMount`, `query.cancel()` semantics.
  - url: https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState
    why: `visibilitychange` drives pause/resume.
  - url: https://developer.mozilla.org/en-US/docs/Web/HTTP/Conditional_requests
    why: `If-None-Match` / 304 path.
  - file: PRPs/clusterB/harness-contracts.md
    section: "10-33 (TDD), 230-348 (task ordering)"
    why: Style template.
  - file: PRPs/clusterD/04-dashboard-vite-skeleton.md
    why: QueryClient defaults, react-virtual install, theme palette,
      API client + ETag plumbing. No new deps here.
  ```

  ## Files to create

  - `packages/dashboard/src/views/VerdictTimeline.tsx`
  - `packages/dashboard/src/views/VerdictTimeline.test.tsx`
  - `packages/dashboard/src/views/VerdictTimeline.perf.test.tsx`
  - `packages/dashboard/src/views/components/DecisionBadge.tsx`
  - `packages/dashboard/src/views/components/DecisionBadge.test.tsx`
  - `packages/dashboard/src/views/hooks/useVerdictsQuery.ts`
  - `packages/dashboard/src/views/hooks/useVerdictsQuery.test.ts`
  - `packages/dashboard/src/views/state/selectedVerdict.ts`
  - `packages/dashboard/src/views/state/selectedVerdict.test.ts`

  ## Files to modify

  - `packages/dashboard/src/App.tsx` — replace the left-pane placeholder
    with `<VerdictTimeline />`. No new prop wiring; the view reads
    selection state via the singleton hook.

  No `package.json` changes. All deps (`react-query`, `react-virtual`)
  arrived in PRP 04.

  ## Target pseudocode — `VerdictTimeline.tsx`

  ```tsx
  // ≤200 lines incl. JSX. Composition only; hooks and badge live elsewhere.
  import { useRef, useState } from "react";
  import { useVirtualizer } from "@tanstack/react-virtual";
  import { useVerdictsQuery } from "./hooks/useVerdictsQuery.js";
  import { setSelectedVerdictId } from "./state/selectedVerdict.js";
  import { DecisionBadge } from "./components/DecisionBadge.js";

  const ROW_PX = 56;

  export function VerdictTimeline(): JSX.Element {
    const [kind, setKind] = useState<"verdict" | "profile_job_dlq">("verdict");
    const query = useVerdictsQuery({ kind });
    const parentRef = useRef<HTMLDivElement>(null);
    const rows = query.data?.rows ?? [];
    const v = useVirtualizer({
      count: rows.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => ROW_PX,
      overscan: 5,
    });

    if (query.isError) {
      return (
        <div data-testid="timeline-error" role="alert">
          <span>Failed to load verdicts.</span>
          <button onClick={() => query.refetch()}>Retry</button>
        </div>
      );
    }
    if (!query.isLoading && rows.length === 0) {
      return <div data-testid="timeline-empty">No verdicts yet</div>;
    }
    return (
      <section aria-label="Verdict timeline">
        <nav role="tablist">
          <button role="tab" aria-selected={kind === "verdict"}
            onClick={() => setKind("verdict")}>Verdicts</button>
          <button role="tab" aria-selected={kind === "profile_job_dlq"}
            onClick={() => setKind("profile_job_dlq")}>Jobs</button>
        </nav>
        <div ref={parentRef} style={{ height: 600, overflow: "auto" }}>
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((vi) => {
              const row = rows[vi.index];
              return <VerdictRow key={row.id} row={row} top={vi.start} />;
            })}
          </div>
        </div>
      </section>
    );
  }
  // VerdictRow: tabindex=0, onKeyDown Enter → setSelectedVerdictId(row.id),
  // onClick same. Renders timestamp, badge, pageUrl (ellipsis), latencyMs,
  // policyVersion, lobstertrapTraceId chip when non-null.
  ```

  ## Target pseudocode — `useVerdictsQuery.ts`

  ```ts
  // ≤80 lines. React Query owns cadence; visibility + debounce owned here.
  import { useEffect, useRef } from "react";
  import { useQuery, useQueryClient } from "@tanstack/react-query";
  import { fetchVerdicts } from "../../api/client.js"; // from PRP 04

  type Args = { kind: "verdict" | "profile_job_dlq"; since?: string;
    until?: string; decision?: "ALLOW" | "DENY" | "HUMAN_REVIEW" };

  export function useVerdictsQuery(args: Args) {
    const qc = useQueryClient();
    const etagRef = useRef<string | null>(null);
    const query = useQuery({
      queryKey: ["verdicts", args],
      queryFn: async () => {
        const res = await fetchVerdicts(args, etagRef.current);
        if (res.status === 304) return qc.getQueryData(["verdicts", args]);
        etagRef.current = res.etag;
        return res.body;
      },
      refetchInterval: 1000,
      staleTime: 500,
      refetchOnMount: false,
    });

    useEffect(() => {
      let t: ReturnType<typeof setTimeout> | undefined;
      const onVis = () => {
        if (document.visibilityState === "hidden") {
          if (t) clearTimeout(t);
          query.cancel();
        } else {
          if (t) clearTimeout(t);
          t = setTimeout(() => query.refetch(), 250);
        }
      };
      document.addEventListener("visibilitychange", onVis);
      return () => {
        if (t) clearTimeout(t);
        document.removeEventListener("visibilitychange", onVis);
      };
    }, [query]);

    return query;
  }
  ```

  ## Target pseudocode — `selectedVerdict.ts`

  ```ts
  // ≤40 lines. Module-singleton + useSyncExternalStore. No deps.
  type Listener = () => void;
  let current: string | null = null;
  const listeners = new Set<Listener>();
  export function setSelectedVerdictId(id: string | null): void {
    if (id === current) return;
    current = id;
    listeners.forEach((l) => l());
  }
  export function getSelectedVerdictId(): string | null { return current; }
  export function subscribeSelectedVerdictId(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  }
  // hook (separate export):
  // useSelectedVerdictId = () => useSyncExternalStore(
  //   subscribeSelectedVerdictId, getSelectedVerdictId, getSelectedVerdictId);
  // Test-only: __resetSelectedVerdictId() to clear between tests.
  ```

  ## Task order (TDD)

  1. **Red→Green: `DecisionBadge` tests** — happy (ALLOW: green hex from
     `theme.ts`, `check-circle` svg with `aria-label="ALLOW"`, literal
     text "ALLOW"); edge (HUMAN_REVIEW: amber + `alert-circle`);
     failure (unknown decision via `as any` renders neutral fallback +
     `console.warn`, never throws). Then implement `DecisionBadge.tsx`
     (color + icon + text — no color-only differentiation).
  2. **Red→Green: `selectedVerdict` store tests** — happy
     (`setSelectedVerdictId("abc")` fires subscribers); edge
     (`setSelectedVerdictId(null)` clears); failure (consumer rendered
     with `useSyncExternalStore` re-renders only when id changes, via
     render-count spy). Then implement the singleton + hook.
  3. **Red→Green: `useVerdictsQuery` happy + visibility tests** — happy
     (`refetchInterval` is 1000 while `visibilityState === "visible"`);
     edge (fire `visibilitychange` to `hidden` → `query.cancel()`
     called, no fetches in next 1500ms — fake timers); edge (5x
     `visibilitychange` to `visible` in 100ms → only one resume fires
     after 250ms). Then implement hook (sans ETag wiring).
  4. **Red→Green: ETag/304 test** — first fetch returns ETag; second
     fetch sends `If-None-Match` and returns 304 → react-query returns
     cached data, render-count spy does NOT increment. Then wire
     `etagRef` + `If-None-Match` header through the PRP-04 API client.
  5. **Red→Green: `useVerdictsQuery` failure test** — backend returns
     500 → error surfaces (`query.isError === true`), ETag ref NOT
     updated. Then verify error-path branch keeps `etagRef` untouched.
  6. **Red→Green: `VerdictTimeline` happy test** — 5-row fixture,
     assert badges (color via `getComputedStyle` on `data-testid`, svg
     `aria-label`, text label), timestamps, ellipsised URL,
     `latencyMs` "47 ms" format, `policyVersion`,
     `lobstertrapTraceId`-chip when non-null. Then implement view
     skeleton + virtualizer with row height 56px / overscan 5.
  7. **Red→Green: empty + failure tests** — `rows: []` →
     `data-testid="timeline-empty"` with "No verdicts yet"; query 500
     → `data-testid="timeline-error"` with banner + Retry button;
     clicking Retry triggers `query.refetch` spy once. Two **separate**
     test IDs; two **separate** tests. Then implement both states.
  8. **Red→Green: keyboard nav test** — `userEvent.tab()` reaches first
     row (`tabindex="0"`); `userEvent.keyboard("{Enter}")` calls
     `setSelectedVerdictId` with the row id; `userEvent.keyboard("{Escape}")`
     blurs focus back to the container. Then implement focus management
     (onKeyDown on row, ref on container for escape-blur).
  9. **Red→Green: tab toggle test** — clicking the "Jobs" tab fires a
     query with `kind: "profile_job_dlq"`; spy on `fetchVerdicts`
     confirms the param. Then wire the local `useState`-driven tab.
  10. **Red→Green: 304 view-level test** — render twice; second render
      with the same ETag → render-count spy fires only twice (one per
      render attempt), row DOM is the *same node* (assert via
      `toBe(sameNode)` on a stable row `ref`).
  11. **Red→Green: perf gate** — `VerdictTimeline.perf.test.tsx`. Seed
      cache with 1000-row fixture (all advertiser A, plausible
      decision distribution); render in RTL with explicit
      `getBoundingClientRect` override per `@tanstack/react-virtual`'s
      `measureElement` path. Assert: `performance.now()` delta across
      the render-commit cycle stays under **100 ms** (conservative —
      demo-machine threshold; rationale: jsdom is faster than real
      paint, so a real per-frame `<16ms` gate is unsafe here); render
      count for `<VerdictRow />` ≤ **20** (overscan window of 5 +
      visible 600/56 ≈ 11, doubled as headroom). **If jsdom can't
      measure scroll reliably, mark the per-frame portion `it.skip`
      with a comment: must re-enable under `vitest-browser` or
      Playwright. Do NOT fake-pass it.**
  12. **Wire `App.tsx` slot** — replace left-pane placeholder with
      `<VerdictTimeline />`. App-level test (already in PRP 04) that
      asserts the Lobster Trap iframe still mounts MUST stay green.
  13. **Final sweep** — `tsc --noEmit`, `eslint --fix`,
      `pnpm -r build`, full `@scout/dashboard` test run including
      `VerdictTimeline.perf`.

  ## Security guardrails

  - **No LLM calls.** Pure read-side rendering.
  - **Row content rendered, never executed.** `decision` is narrowed
    through `DecisionSchema` before reaching `DecisionBadge`; unknown
    values hit the neutral fallback, never an arbitrary class/color.
  - **`pageUrl` rendered as text, not `<a href>`** in v1. A hostile
    audit row cannot smuggle `javascript:` URIs into the DOM.
    Clickable URLs are a follow-up (needs scheme allowlist).
  - **Visibility-pause is a cost guardrail.** Idle overnight tab must
    not keep polling.
  - **No `dangerouslySetInnerHTML`.** Grep test:
    `expect(srcDir).not.toMatch(/dangerouslySetInnerHTML/)`.
  - **No secrets in client.** No `VITE_*` env var introduced.

  ## Out of scope

  - `ReasonsDrilldown` rendering — PRP 06 (consumes the selection
    singleton emitted here).
  - `IntentDiff` view + bottom-right tab — PRP 07.
  - `App.demo.test.tsx` (5 scenarios + axe-core) — PRP 07.
  - URL deep-linking (`?selected=<id>`) — follow-up.
  - Search / filter UI beyond the tab toggle — follow-up.
  - SSE upgrade — feature file lines 113-116 lock polling; v2 PRP.
  - Clickable `pageUrl` anchors — follow-up (XSS hardening).
  - Rich DLQ row UI — tab toggle wires here; v1 reuses `VerdictRow`
    + a "DLQ" badge; richer DLQ rendering is follow-up.

  ## Anti-patterns

  - Don't wrap `pageUrl` — variable row height breaks virtualization.
  - Don't always-mount the Drilldown — PRP 06 owns that conditional.
  - Don't add a charting lib — DLQ `attempts` is text; PRP 06/07 bars
    are hand-rolled CSS (feature file line 64).
  - Don't render a color-only badge — color + icon + text is
    non-negotiable for a11y (axe-core in PRP 07 will fail otherwise).
  - Don't `setInterval` inside the component — React Query owns
    cadence.
  - Don't poll while the tab is hidden — visibility pause is
    load-bearing.
  - Don't `dangerouslySetInnerHTML` anywhere.
  - Don't make tab-toggle a route — feature file line 81 locks
    `useState`.
  - Don't fake-pass the perf gate — `it.skip` with a comment is fine;
    hand-tuned always-passing thresholds are not.
  - Don't import `@scout/store` / `@scout/llm-client` — ESLint
    boundary blocks; surfacing the error means the PRP is misplaced.

  ## Validation gates

  ```bash
  pnpm --filter @scout/dashboard test
  pnpm --filter @scout/dashboard test -- VerdictTimeline.perf
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r build
  ```

  ## Confidence: 8 / 10

  Risk concentrates in the perf gate under jsdom (poor measurement
  environment). The `it.skip` escape hatch keeps the PRP shippable
  without lying about coverage. Polling + visibility + ETag plumbing
  is well-trodden; task order isolates each interaction (cancel,
  debounce, conditional fetch) into its own red→green so failures
  pinpoint the right surface. `useSyncExternalStore` singleton is the
  lightest cross-PRP state seam consistent with "no new deps."
