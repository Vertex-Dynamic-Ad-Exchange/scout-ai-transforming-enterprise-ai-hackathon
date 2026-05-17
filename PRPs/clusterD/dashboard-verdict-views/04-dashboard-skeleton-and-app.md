name: "Dashboard — PRP 04: Vite + React skeleton, `App.tsx`, Lobster Trap iframe (TDD)"
description: |

  Fourth of seven PRPs implementing `features/clusterD/dashboard-verdict-views.md`.
  Replaces `packages/dashboard/src/index.ts` (`export {};`) with a Vite + React
  SPA: three-pane `App.tsx`, Lobster Trap iframe mount, theme palette, React
  Query setup, demo-scenario fixtures placeholder, typed API client, plus two
  security tests (ESLint boundary smoke + post-build bundle-grep).

  **Supersedes foundation task 8** (`PRPs/foundation-ad-verification.md:258-260`).
  Adopts that task's RTL iframe-`src` test verbatim; view PRPs (05–07) add
  their tests on top.

  ## TDD discipline

  Mirrors `PRPs/clusterB/harness-contracts.md:10-34`. Every task is
  **red → green → refactor**. Confirm fail for the *expected reason*
  (`ERR_MODULE_NOT_FOUND`, `TS2307`, RTL `getByRole(...)` throwing on
  missing markup). Wrong-reason fails (typo, jsdom config) aren't real
  reds. Commit at green; never at red unless message says `WIP — red`.
  Task 1 (tooling) has no behavior to assert — commit plain; the
  red→green cadence starts at Task 2.

  ## Why this PRP exists separately

  View PRPs 05/06/07 each need Vite/React installed, `App.tsx` layout
  to slot into, the API client + React Query provider, and the iframe
  contract wired. Landing this together keeps them to **one component
  file each** — no cross-PRP `package.json`/`vite.config.ts` collisions.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A. Dashboard is read-side of an async-written
    audit log. Budget: "renders 100 verdicts without jank" (`<16ms`/
    frame), pinned in PRP 05. NOT the gate's SLA.
  - **Pre-bid** — N/A. Governance UI; does not gate any auction.
  - **Plug-and-play** — The SPA + backend (PRP 03) pair IS the seam.
    Dashboard talks HTTP only; never imports `@scout/store` (ESLint
    boundary enforces, Task 9 smoke-tests).
  - **Sponsor tech** — Track 1 Veea: the Lobster Trap iframe IS the
    showpiece. Foundation Q8 locked this; this PRP wires it, does NOT
    relitigate. Track 2 Gemini: untouched (no LLM calls in dashboard).

  ## CLAUDE.md rules that bite

  - **§ Working agreements — "Ask before adding a dependency."** This
    PRP is the asking; the Decisions table is the contract.
  - **§ Working agreements — "No `VITE_*` env var holds a secret."**
    Task 8 bundle-grep pins it.
  - **§ Working agreements — 300-line cap.** `App.tsx` stays small
    (layout + slots only; view bodies land in 05–07). Already split:
    `iframe/LobstertrapPane.tsx`.

  ## Decisions (locked here)

  | # | Question | Locked answer | Why |
  |---|---|---|---|
  | D1 | React major | **18** (`^18.3.0`). | RQ 5.x + RTL 16 peer-ranges cover 18 cleanly; React 19 is a post-demo revisit. |
  | D2 | Vite major | `^5.4.0`. | Matches `@vitejs/plugin-react ^4.3.x` peer. |
  | D3 | React Query | `@tanstack/react-query ^5.59.0`. | v5 `useQuery` shape PRP 05 depends on. |
  | D4 | React Virtual | `@tanstack/react-virtual ^3.10.0`. | Installed here so package compiles end-to-end; consumed in PRP 05. |
  | D5 | a11y audit lib | `vitest-axe ^0.1.0`. | Native vitest matcher; avoids jest-axe shim. |
  | D6 | iframe `sandbox` | `"allow-same-origin allow-scripts"`. **No `allow-top-navigation`, no `allow-popups-to-escape-sandbox`.** | Feature spec line 128. A compromised LT UI must not redirect parent. |
  | D7 | iframe failure UX | `onError` → fallback `<a href={VITE_LOBSTERTRAP_URL} target="_blank" rel="noopener noreferrer">`. No auto-retry. | Spec line 165. Retry hides the underlying CSP/availability bug. |
  | D8 | Bundle-grep globs | `dist/**/*.{js,mjs,html,css}`. Strings: `GEMINI_API_KEY`, `OPENAI_API_KEY`, `LOBSTERTRAP_BEARER`. | The three secret env-var names in the system today. |
  | D9 | Palette | `ALLOW = "#16a34a"`, `DENY = "#dc2626"`, `HUMAN_REVIEW = "#d97706"`. Icons: inline SVG `check-circle` / `x-circle` / `alert-circle`. | Spec line 71. AA contrast verified in `theme.ts` JSDoc. |
  | D10 | `staleTime` / refetch | `staleTime: 500`, `refetchOnMount: false`, `refetchOnWindowFocus: false`. Visibility pause = per-query in PRP 05, not globally. | Spec lines 113, 166. |
  | D11 | `VITE_DEMO_ADVERTISER_ID` | Session ID, NOT a secret. Excluded from bundle-grep. Real auth → `dashboard-auth.md`. | Documented in `.env.example` + `api/client.ts` JSDoc. |
  | D12 | `App.tsx` extraction | Extract `iframe/LobstertrapPane.tsx` now; extract more only if `App.tsx` exceeds 200 lines. | 300-line cap headroom for view integration. |

  ## All Needed Context

  ```yaml
  - file: features/clusterD/dashboard-verdict-views.md
    section: "lines 13-15 (foundation seam + ESLint boundary), 24
      (three-pane layout + iframe sandbox), 56-65 (perf bar + no-charting
      ethos), 91-101 (docs links), 124-136 (iframe contract + no-secrets
      rules), 163-174 (gotchas)."
    why: Source spec; D6/D7/D8/D9 cite these directly.

  - file: PRPs/foundation-ad-verification.md
    section: "Q8 (line 31), ESLint boundary (155-156), task 8 (258-260)."
    why: Q8 locks the iframe approach; task 8 is superseded by this PRP.

  - file: PRPs/clusterD/01-audit-and-intent-contracts.md
  - file: PRPs/clusterD/02-store-audit-read-interface.md
  - file: PRPs/clusterD/03-dashboard-backend-package.md
    why: Assumes 01–03 merged. API client hits PRP 03 routes; fixtures
      consume `AuditRow` from PRP 01.

  - file: PRPs/clusterB/harness-contracts.md
    why: Style template (Decisions, Task order, anti-patterns,
      confidence). Mirror its shape.

  - file: packages/dashboard/package.json
  - file: packages/dashboard/tsconfig.json
  - file: packages/dashboard/src/index.ts
    why: The three files this PRP rewrites/extends.

  - url: https://vitejs.dev/guide/env-and-mode.html
    why: VITE_* exposure model — every VITE_* is shipped to client.
      D8 bundle-grep pins the no-secrets rule.

  - url: https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching
  - url: https://tanstack.com/query/latest/docs/framework/react/guides/dependent-queries
  - url: https://tanstack.com/virtual/latest/docs/framework/react/react-virtual
    why: PRP 05 builds on these. Installed here so package compiles.

  - url: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox
  - url: https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState
  - url: https://developer.mozilla.org/en-US/docs/Web/HTTP/Conditional_requests
    why: Sandbox model (D6); visibility + ETag consumed in PRP 05.

  - url: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum
    why: Cite in `theme.ts` JSDoc for D9 contrast claim.
  ```

  ## Files to create

  - `packages/dashboard/vite.config.ts`
  - `packages/dashboard/vitest.config.ts`
  - `packages/dashboard/test-setup.ts`
  - `packages/dashboard/index.html`
  - `packages/dashboard/src/main.tsx`
  - `packages/dashboard/src/App.tsx`
  - `packages/dashboard/src/queryClient.ts`
  - `packages/dashboard/src/theme.ts`
  - `packages/dashboard/src/iframe/LobstertrapPane.tsx`
  - `packages/dashboard/src/api/client.ts`
  - `packages/dashboard/src/fixtures/demoScenarios.ts`
  - `packages/dashboard/src/App.test.tsx`
  - `packages/dashboard/src/queryClient.test.ts`
  - `packages/dashboard/src/__bundle__/no-secrets.test.ts`
  - `packages/dashboard/__eslint-smoke__/violation.ts` — created +
    deleted inside Task 9's script; never committed.

  ## Files to modify

  - `packages/dashboard/package.json` — add deps + devDeps + scripts:
    - deps: `react ^18.3.0`, `react-dom ^18.3.0`,
      `@tanstack/react-query ^5.59.0`, `@tanstack/react-virtual ^3.10.0`,
      `zod` (explicit, already transitive), `@scout/shared workspace:*`.
    - devDeps: `vite ^5.4.0`, `@vitejs/plugin-react ^4.3.0`,
      `vitest ^2.0.0`, `@testing-library/react ^16.0.0`,
      `@testing-library/user-event`, `@testing-library/jest-dom`,
      `jsdom`, `vitest-axe ^0.1.0`, `@types/react`, `@types/react-dom`,
      `typescript ^5.6.3`.
    - scripts: `dev: vite`, `build: tsc --noEmit && vite build`,
      `test: vitest run`, `test:watch: vitest`,
      `typecheck: tsc --noEmit`.
  - `packages/dashboard/tsconfig.json` — add `"jsx": "react-jsx"` and
    `"lib": ["ES2022", "DOM", "DOM.Iterable"]` to `compilerOptions`.
  - `packages/dashboard/src/index.ts` — replace `export {};` with
    `export * from "./App.js";` (barrel for downstream PRPs).
  - `.env.example` — append:
    ```
    VITE_LOBSTERTRAP_URL=http://localhost:8080/_lobstertrap/
    VITE_DASHBOARD_BACKEND_URL=http://localhost:5173
    VITE_DEMO_ADVERTISER_ID=demo-advertiser
    ```

  ## Target `App.tsx` layout (pseudocode)

  ```tsx
  // packages/dashboard/src/App.tsx
  import { LobstertrapPane } from "./iframe/LobstertrapPane.js";
  // Reason: view bodies land in PRPs 05/06/07. Slots render placeholder
  // text the App.test.tsx assertions look up via getByTestId until then.

  export function App(): JSX.Element {
    return (
      <main
        data-testid="dashboard-root"
        style={{
          display: "grid",
          gridTemplateColumns: "40% 60%",
          gridTemplateRows: "60% 40%",
          gridTemplateAreas: `"timeline drilldown" "timeline lobstertrap"`,
          height: "100vh",
          width: "100vw",
        }}
      >
        <section data-testid="pane-timeline" aria-label="Verdict Timeline"
          style={{ gridArea: "timeline", overflow: "auto" }}>
          {/* PRP 05 mounts <VerdictTimeline /> here */}
          <p>Verdict Timeline</p>
        </section>
        <section data-testid="pane-drilldown" aria-label="Reasons Drilldown"
          style={{ gridArea: "drilldown", overflow: "auto" }}>
          {/* PRP 06 mounts <ReasonsDrilldown /> here */}
          <p>Reasons Drilldown</p>
        </section>
        <section data-testid="pane-lobstertrap" aria-label="Lobster Trap"
          style={{ gridArea: "lobstertrap", overflow: "hidden" }}>
          {/* IntentDiff (PRP 07) lands as a tab inside this pane. */}
          <LobstertrapPane />
        </section>
      </main>
    );
  }
  ```

  ## Task order (TDD; commit-sized)

  ### Task 1 — Toolchain wiring (no tests)

  Update `package.json` per D1–D5. Update `tsconfig.json` (jsx + lib).
  Create `vite.config.ts` (react plugin + dev proxy `/api` →
  `VITE_DASHBOARD_BACKEND_URL`), `index.html` (single `#root` + module
  script `src/main.tsx`), `vitest.config.ts`
  (`environment: "jsdom"`, setup file), `test-setup.ts` (imports
  `@testing-library/jest-dom`, `vitest-axe`). `pnpm install`. Verify
  `pnpm --filter @scout/dashboard typecheck`.

  ### Task 2 — Red→Green: `App.tsx` happy render (preserves foundation task 8)

  Write `App.test.tsx` happy case: render `<App />` inside
  `QueryClientProvider`, assert three panes and the foundation iframe
  test:
  ```ts
  expect(screen.getByTestId("pane-timeline")).toBeInTheDocument();
  expect(screen.getByTestId("pane-drilldown")).toBeInTheDocument();
  expect(screen.getByTestId("pane-lobstertrap")).toBeInTheDocument();
  expect(screen.getByTitle(/lobster trap/i)).toHaveAttribute(
    "src", import.meta.env.VITE_LOBSTERTRAP_URL,
  );
  ```
  Red → `Cannot find module './App.js'`. Green: create `theme.ts`,
  `queryClient.ts`, `main.tsx`, `App.tsx`, `iframe/LobstertrapPane.tsx`
  per Target layout. Iframe gets `title="Lobster Trap audit"`,
  `src={import.meta.env.VITE_LOBSTERTRAP_URL}`,
  `sandbox="allow-same-origin allow-scripts"` (D6). Refactor: `tsc
  --noEmit` clean.

  ### Task 3 — Red→Green: iframe pre-load skeleton

  Extend `App.test.tsx` (edge): before iframe `onLoad`, assert
  `screen.getByText(/loading lobster trap audit ui/i)` visible.
  `fireEvent.load(screen.getByTitle(/lobster trap/i))` → skeleton text
  removed. Red → no skeleton state. Green: add `loaded: boolean` in
  `LobstertrapPane`; render skeleton until `onLoad` fires.

  ### Task 4 — Red→Green: iframe `onError` fallback link

  Extend `App.test.tsx` (failure): `fireEvent.error(iframe)` →
  `screen.getByRole("link", { name: /open lobster trap dashboard in new tab/i })`
  with `href === VITE_LOBSTERTRAP_URL`, `target="_blank"`, `rel`
  containing `"noopener"`. Red → fail. Green: add `error: boolean`
  state; on error, swap iframe for fallback link.

  ### Task 5 — Red→Green: `queryClient.ts` smoke test

  `queryClient.test.ts`: assert
  `queryClient.getDefaultOptions().queries?.staleTime === 500`,
  `refetchOnMount === false`, `refetchOnWindowFocus === false`. Pins
  D10 constants PRP 05 depends on. Red → fail. Green: configure
  `QueryClient` per D10. JSDoc cites PRP 05 for the visibility-state
  pause being implemented per-query, not globally.

  ### Task 6 — Demo-scenarios fixture placeholder

  Create `fixtures/demoScenarios.ts`:
  ```ts
  import type { AuditRow } from "@scout/shared";
  export type DemoScenario = { name: string; row: AuditRow };
  export const demoScenarios: DemoScenario[] = [];
  // Reason: PRP 07 fills the five fixtures (clean ALLOW, clean DENY,
  // ambiguous Flash escalation, HUMAN_REVIEW disagreement, cache-miss
  // DENY-then-warm). PRP 04 lands the file so views compile against
  // the type. Empty array intentional; PRP 07 asserts length === 5.
  ```
  No test in 04. Type-check is the gate.

  ### Task 7 — `api/client.ts` typed fetch wrapper

  Export `listVerdicts`, `getVerdict`, `evidenceUrl` (returns URL
  string — `<img src>` hits proxy directly). All requests carry
  `x-advertiser-id: import.meta.env.VITE_DEMO_ADVERTISER_ID`. Responses
  parsed via `AuditRowSchema` from `@scout/shared` (PRP 01). JSDoc:
  "`VITE_DEMO_ADVERTISER_ID` is a session id, NOT a secret. Real auth
  in `dashboard-auth.md` follow-up." No test in 04 (PRP 05 exercises
  end-to-end via MSW). Type-check gates.

  ### Task 8 — Red→Green: bundle-grep `no-secrets.test.ts`

  ```ts
  import { readFileSync, readdirSync, statSync } from "node:fs";
  import { join, resolve } from "node:path";

  const dist = resolve(__dirname, "../../dist");
  const FORBIDDEN = ["GEMINI_API_KEY", "OPENAI_API_KEY", "LOBSTERTRAP_BEARER"];
  const EXT = /\.(js|mjs|html|css)$/;

  function* walk(dir: string): Iterable<string> {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) yield* walk(p);
      else if (EXT.test(p)) yield p;
    }
  }

  it("dist/ contains no secret strings", () => {
    for (const f of walk(dist)) {
      const c = readFileSync(f, "utf8");
      for (const k of FORBIDDEN) expect(c).not.toContain(k);
    }
  });
  ```
  **Must run AFTER `vite build`.** Separate vitest pattern:
  `pnpm --filter @scout/dashboard test -- bundle/`. README documents:
  CI runs `build` → `test -- bundle/` in sequence; ENOENT on missing
  `dist/` IS the failure signal. Red → fail (no `dist/`). `pnpm
  --filter @scout/dashboard build` → green.

  ### Task 9 — ESLint boundary smoke

  `__eslint-smoke__/run.sh` (or vitest shell-out): write
  `__eslint-smoke__/violation.ts` containing `import "@scout/store";`.
  Run `pnpm -r exec eslint packages/dashboard/__eslint-smoke__/violation.ts`.
  Assert non-zero exit. **Delete file in `finally`** (mirrors
  `foundation-ad-verification.md:161-163`).

  Workaround if foundation ESLint config not yet landed: `// @ts-expect-error`
  variant — `import "@scout/store"` in a `.test.ts` + assert TypeScript
  or resolution error. Replace once foundation lands the rule.

  ### Task 10 — Full validation sweep

  ```bash
  pnpm --filter @scout/dashboard test
  pnpm --filter @scout/dashboard build
  pnpm --filter @scout/dashboard test -- bundle/
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm audit
  ```
  No new high-severity advisories expected. If `pnpm audit` regresses,
  surface package + advisory ID; do NOT pin a forced resolution without
  sign-off.

  ## Security guardrails

  - **Bundle-grep enforces "no secrets in client"** (CLAUDE.md
    § Working agreements). Task 8 is the test. Forbidden-strings list
    grows whenever a new secret env-var name lands (currently 3).
  - **iframe sandbox prevents top-navigation hijack.** D6 omits
    `allow-top-navigation`; PRP 05's keyboard-nav test asserts
    `window.location.href` unchanged after iframe interactions
    (documented; out of scope here).
  - **ESLint boundary** prevents `@scout/store` from `dashboard/`
    (foundation `foundation-ad-verification.md:155-156`); Task 9
    smoke-tests it. `@scout/dashboard-backend` (PRP 03) is the only
    server-side `@scout/store` consumer.
  - **`VITE_DEMO_ADVERTISER_ID` is a session ID, NOT a secret** (D11).
    `.env.example` + `api/client.ts` JSDoc say so; excluded from
    bundle-grep. Real auth = `dashboard-auth.md` follow-up.
  - **Fallback link** `rel="noopener noreferrer"` prevents opener leak.

  ## Out of scope (follow-up PRPs)

  - View bodies — `VerdictTimeline` (05), `ReasonsDrilldown` (06),
    `IntentDiff` (07). Tab toggle inside bottom-right pane lands in 07.
  - Fixture content for `demoScenarios.ts` — PRP 07. PRP 04 lands file
    + `DemoScenario` type only.
  - `App.demo.test.tsx` five-scenario regression — PRP 07.
  - Real auth (OIDC) — `dashboard-auth.md`.
  - Mobile / dark mode / i18n — feature spec lines 149-151.
  - SSE / WebSocket — polling is locked (spec line 113); revisit if
    demo lag exceeds 10s.
  - Visibility-state polling pause — implemented per-query in PRP 05,
    NOT globally. Documented in `queryClient.ts` JSDoc.

  ## Anti-patterns

  - Don't put any secret in a `VITE_*` var. Bundle-grep will catch it.
  - Don't add `allow-top-navigation`, `allow-popups`, or
    `allow-popups-to-escape-sandbox` to iframe sandbox. The two allowed
    tokens are `same-origin` + `scripts`.
  - Don't import `@scout/store` from `packages/dashboard/**`. ESLint +
    Task 9 catch it; server-side reads live in `@scout/dashboard-backend`.
  - Don't add `react-icons`, `lucide-react`, or any icon lib. Three
    palette icons are inline SVG in `theme.ts` (no-bloat ethos, feature
    spec 56-65).
  - Don't pin `*-latest` versions. Each dep gets `^X.Y.Z` floor from
    `pnpm view <pkg> version` on the day this PRP merges.
  - Don't auto-retry the iframe on `onError` (D7).
  - Don't widen `staleTime` past 500ms or set `refetchOnWindowFocus:
    true` here; PRP 05 depends on these constants.
  - Don't commit `__eslint-smoke__/violation.ts`. Lifetime = Task 9.
  - Don't commit at red unless message says `WIP — red`.

  ## Confidence: 8 / 10

  Greenfield React skeleton in a strict-TS monorepo with no existing
  JSX precedent. Risks: (a) `vitest-axe ^0.1.0` API may drift —
  mitigation: only PRP 07 uses `toHaveNoViolations`; (b) bundle-grep
  depends on a successful `vite build` — if a downstream PRP breaks
  build, the secrets check goes silent. CI must run `build` and
  `test -- bundle/` as separate steps; build failure must fail the
  pipeline before bundle test runs.
