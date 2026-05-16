name: "Harness — PRP-C2: two-pass Browser→Agent fallback + README + CLAUDE.md lock (TDD)"
description: |

  Fifth of five PRPs for `features/clusterB/harness-capture-page.md`. Closes
  the chain: lands `capture.ts` (the two-pass orchestrator that retries via
  Agent mode on `BLOCKED` / `CONSENT_WALL_UNRESOLVED`), rewires `factory.ts`
  to delegate to it (replacing the PRP-C1 interim conditional), ships the
  `packages/harness/README.md` documenting the agreed sponsor-tech
  exception, and updates `CLAUDE.md § Stack` with the locked decisions.

  **Prereqs**: PRP-A, PRP-B1, PRP-B2, PRP-C1 merged.

  ## TDD discipline

  **Red → Green → Refactor.** Test first; correct-reason red; minimum
  impl; tidy. Commit at green. Mocks for `browser-use-sdk` are reused
  from PRP-B2/PRP-C1 — extend, don't duplicate.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A; warm path.
  - **Pre-bid** — Boundary unchanged (PRP-B2 Task 13 still pinned).
  - **Plug-and-play** — Same `Harness` surface; orchestrator is internal.
  - **Sponsor tech** — Task 4 + Task 5 make the agreed exception explicit
    in the README and CLAUDE.md so future readers can find it without
    re-deriving.

  ## CLAUDE.md rules that bite

  - § Update protocol — when a decision lands, append to § Stack. Task
    5 IS that update.
  - 300-line file cap on every file written here (README ≤ 200).

  ## Decisions (locked here)

  | # | Question | Locked answer |
  |---|---|---|
  | D1 | Fallback trigger | `HarnessError.BLOCKED` OR `HarnessError.CONSENT_WALL_UNRESOLVED` from Browser mode → retry via Agent. Only these two codes. `TIMEOUT` does NOT retry. |
  | D2 | Fallback warning | `"consent_wall_handled_via_agent_mode"` pushed to `result.warnings` on a successful fallback capture. Pinned verbatim — profiler observes the warning to understand the path taken. |
  | D3 | `forceAgentMode` semantics | When `true`, Browser mode is never invoked. No fallback warning (it's a forced direct path, not a fallback). |
  | D4 | Both-modes-failed semantics | Throw `HarnessException` with the **Agent-mode** error code (the second attempt's outcome). Browser mode's error is lost to the caller (logged at debug only). Profiler nacks the job. |
  | D5 | Smoke script update | Add at least one known-consent-wall URL to the smoke fixture set so live verification exercises the two-pass on every run. |

  ## All Needed Context

  ```yaml
  - file: PRPs/clusterB/harness-contracts.md
    why: Prereq A — types.
  - file: PRPs/clusterB/harness-browser-helpers.md
    why: Prereq B1.
  - file: PRPs/clusterB/harness-browser-mode.md
    why: Prereq B2 — Browser mode body and the existing factory wire.
  - file: PRPs/clusterB/harness-agent-mode.md
    why: Prereq C1 — Agent mode body, consent-wall heuristic, interim
      forceAgentMode wire that this PRP replaces.

  - file: features/clusterB/harness-capture-page.md
    section: "Agent-mode escape hatch (line 49); license question
      (lines 50, 111-114); Security guardrails (lines 151-158);
      Sponsor-tech relevance (line 109)"
    why: Source spec for fallback + the agreed-exception documentation.

  - file: CLAUDE.md
    section: "§ Stack; § Update protocol"
    why: Task 5 appends locked decisions.

  - file: PRPs/foundation-ad-verification.md
    section: "Decisions table Q4-Q5 (lines 27-28); SDK Gotchas (lines
      217-220)"
    why: README closes the loop on Q4 (Cloud-vs-self-host) and on the
      SDK-shape correction.

  - url: https://github.com/browser-use/browser-use/blob/main/LICENSE
    why: MIT — locks D7 (self-host fallback documented; Cloud for demo).
  ```

  ## Files this PRP creates / modifies

  ```
  packages/harness/src/
    capture.ts                 (NEW) + __tests__/capture.test.ts
    factory.ts                 (MOD) — single delegate to capture.ts; remove PRP-C1 interim conditional
  packages/harness/
    README.md                  (NEW)
  packages/harness/scripts/
    smoke-capture.ts           (MOD) — add a known-consent-wall URL
  CLAUDE.md                    (MOD) — append to § Stack
  ```

  ## Task order (TDD)

  ### Task 1 — Red→Green: `capture.ts` two-pass orchestrator

  Red. `capture.test.ts`:

  - **T1a — Browser succeeds → no Agent invocation** — `browserMode`
    mocked to succeed; `agentMode` mocked but never invoked (spy
    `mock.calls.length === 0`). Result: `mode: "browser"`, no
    fallback warning.
  - **T1b — `CONSENT_WALL_UNRESOLVED` → Agent retried → success** —
    `browserMode` mock rejects with
    `HarnessException(CONSENT_WALL_UNRESOLVED, ...)`. `agentMode`
    mock resolves with a valid `PageCapture`. Result: `mode:
    "agent"`, `warnings` includes `"consent_wall_handled_via_agent_mode"`
    (verbatim string pin).
  - **T1c — `BLOCKED` → Agent retried → success** — same as T1b but
    Browser throws `BLOCKED`.
  - **T1d — `TIMEOUT` → NOT retried** — Browser throws `TIMEOUT`;
    `agentMode` spy `mock.calls.length === 0`; orchestrator
    re-throws `TIMEOUT` unchanged.
  - **T1e — `NAVIGATION_FAILED` → NOT retried** — Browser throws
    `NAVIGATION_FAILED` (e.g., PDF URL); orchestrator re-throws
    unchanged.
  - **T1f — Both modes fail** — Browser throws `CONSENT_WALL_UNRESOLVED`;
    Agent ALSO throws `CONSENT_WALL_UNRESOLVED` (or `UPSTREAM_DOWN`).
    Orchestrator throws the Agent-mode error (D4). Browser error is
    NOT exposed to the caller.
  - **T1g — `forceAgentMode: true`** — Browser mode NEVER invoked
    (spy); only `agentMode`. Result: `mode: "agent"`, NO
    `consent_wall_handled_via_agent_mode` warning (forced direct
    path, not fallback).

  Green. `capture.ts`:

  ```ts
  import { CaptureOptionsSchema, HarnessError, HarnessException, type CaptureOptions, type PageCapture } from "@scout/shared";
  import { capturePage as captureViaBrowser } from "./browserMode.js";
  import { captureViaAgent } from "./agentMode.js";

  const FALLBACK_CODES = new Set<string>([HarnessError.BLOCKED, HarnessError.CONSENT_WALL_UNRESOLVED]);

  export async function capturePage(sdk, cfg, url: string, rawOpts: CaptureOptions = {}): Promise<PageCapture> {
    const opts = CaptureOptionsSchema.parse(rawOpts);
    if (opts.forceAgentMode) return captureViaAgent(sdk, cfg, url, opts);
    try {
      return await captureViaBrowser(sdk, cfg, url, opts);
    } catch (err) {
      const code = err instanceof HarnessException ? err.code : undefined;
      if (!code || !FALLBACK_CODES.has(code)) throw err;
      const out = await captureViaAgent(sdk, cfg, url, opts);
      out.warnings.push("consent_wall_handled_via_agent_mode");
      return out;
    }
  }
  ```

  > **Decomposition note**: `CaptureOptionsSchema.parse` moves here
  > from `browserMode.ts` (single entry point now). Update
  > `browserMode.ts` to *assume* parsed options on its signature, or
  > re-parse defensively if calls from elsewhere are possible.
  > Recommend single-parse here; pass through `opts: CaptureOptions`
  > to both impls.

  ### Task 2 — Red→Green: rewire `factory.ts`

  Red. Existing `factory.test.ts` T4a from PRP-C1 + `T2 happy` from
  PRP-B2 should still pass after rewire — they're the regression
  guard. Add a new pin:

  - **T2a — factory delegates to capture.ts** — spy on `capture.ts`'s
    `capturePage`; assert it receives `(sdk, cfg, url, opts)`. Browser
    and Agent impls are no longer imported by `factory.ts` directly.

  Green. Replace `factory.ts` body:

  ```ts
  import { BrowserUse } from "browser-use-sdk";
  import type { Harness } from "@scout/shared";
  import { harnessConfig } from "./config.js";
  import { capturePage } from "./capture.js";

  export function createHarness(): Harness {
    const cfg = harnessConfig();
    const sdk = new BrowserUse({ apiKey: cfg.browserUseApiKey, baseUrl: cfg.browserUseBaseUrl });
    return { capturePage: (url, opts) => capturePage(sdk, cfg, url, opts) } satisfies Harness;
  }
  ```

  Run existing tests (PRP-B2 T2 happy + PRP-C1 T4a) — both must stay
  green.

  ### Task 3 — Smoke script update

  Modify `packages/harness/scripts/smoke-capture.ts` to add a
  fourth URL: a known-consent-wall page (an EU regional news site is
  typical — pick one and hardcode in source). Print output: the
  `mode` field must show `"agent"` on this URL after the two-pass
  fires. If it shows `"browser"`, either the heuristic missed (PRP-C1
  Task 1 D4 trade) or the page isn't actually walled — try another.

  Recording the working URL in the smoke script's source comment so
  the next reader knows the demo guarantee.

  ### Task 4 — `packages/harness/README.md`

  Single-file write. Target ≤ 200 lines. Sections:

  - **Overview** — one-function surface:
    `createHarness().capturePage(url, opts) → PageCapture`. Cite the
    feature file (`features/clusterB/harness-capture-page.md`).
  - **Env vars** — `BROWSER_USE_API_KEY` (required); `BROWSER_USE_BASE_URL`
    (optional). Reference `config.ts` as the single read site.
  - **Cloud vs self-host** — `browser-use` core is MIT (verified
    2026-05-15 at <https://github.com/browser-use/browser-use/blob/main/LICENSE>).
    Hackathon demo uses the Cloud API per
    `PRPs/foundation-ad-verification.md:27`; productionization story
    is "lift and shift to self-host" — point the SDK at a local
    instance via `BROWSER_USE_BASE_URL`. Self-host install/serve
    scripts are a follow-up.
  - **Agent-mode sponsor-tech exception (the agreed bypass)** —
    explicit + named: `client.tasks.create` triggers an LLM loop on
    browser-use Cloud. That LLM is the **vendor's**, not ours. We
    cannot route it through Lobster Trap (no `baseURL` knob for the
    vendor's internal LLM). This is the agreed exception per
    `features/clusterB/harness-capture-page.md:109`. Mitigation:
    - The prompt is a fixed string (`AGENT_TASK_PROMPT`) we control.
    - Only `url` is interpolated (test T3c regex pin).
    - "Do not follow off-origin links" is written into the prompt.
    - `keepAlive: false` + `persistMemory: false` on every session
      bound blast radius.
  - **Two-pass behavior** — Browser mode first; Agent mode on
    `BLOCKED` / `CONSENT_WALL_UNRESOLVED` OR `forceAgentMode: true`.
    `TIMEOUT` does NOT retry (would compound latency cost). Soft
    targets: Browser P95 ≤ 8 s; Agent P95 ≤ 30 s. Hard cap from
    `opts.timeoutMs`.
  - **Smoke script** — `pnpm --filter @scout/harness run smoke` with
    `BROWSER_USE_API_KEY` set. **Required to run at least once before
    May 18–19 onsite.**
  - **`AbortSignal` finding from PRP-B2 Task 12** — record the path
    chosen (A: SDK respects signal, B: `Promise.race`). Future-reader
    signal so the next refactor knows the constraint.
  - **Playwright Chromium download** — `pnpm install` auto-fetches
    ~300 MB. CI may `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (we connect
    via CDP; no local browser needed).
  - **Security summary (5 bullets, verbatim from spec)**:
    1. `BROWSER_USE_API_KEY` only read in `config.ts`; never logged.
    2. Fresh `sessions.create` per `capturePage` — no pooling.
    3. Geo-proxy fidelity: silent US fallback on unavailable proxy
       is forbidden; throw `UPSTREAM_DOWN`.
    4. Off-origin links: not followed (Browser mode never clicks;
       Agent prompt forbids).
    5. `domText` is untrusted — never log full `PageCapture`; verifiers
       in Cluster C treat as data, not instructions (Lobster Trap
       enforces at LLM seam).
  - **Out of scope (v1)** — mobile viewport; multi-region capture;
    PDF rendering; S3/GCS evidence store; perceptual hashing;
    concurrent capture (profiler's domain); self-host install
    scripts.
  - **SDK correction note** — `browser-use-sdk@3.6.0` has a flat
    surface (`client.browsers.*`, `client.sessions.*`,
    `client.tasks.*`). References in
    `features/clusterB/harness-capture-page.md:48` and
    `PRPs/foundation-ad-verification.md:28, 217-219` to
    `client.v2.*` are superseded.

  No test for the README; reviewer verifies the content.

  ### Task 5 — `CLAUDE.md § Stack` update

  Append the following bullets to `CLAUDE.md § Stack` (per the file's
  update protocol):

  - **Harness driver** (locked 2026-05-15) — `browser-use-sdk@^3.6.0`
    Cloud (MIT) + `playwright@^1.49.0` for CDP control. Self-host
    fallback documented in `packages/harness/README.md`; demo uses
    Cloud per foundation Q4.
  - **Cross-package contracts** (locked 2026-05-15) — `PageCapture` +
    `CaptureOptions` schemas + `Harness` interface + `HarnessError`
    enum live in `@scout/shared` (`schemas/capture.ts` +
    `interfaces/harness.ts`; first occupant of `interfaces/`).
  - **Agent-mode sponsor-tech exception** (locked 2026-05-15) — the
    browser-use Agent-mode loop calls the vendor's internal LLM (not
    ours). This LLM does NOT route through Lobster Trap. Mitigation:
    `AGENT_TASK_PROMPT` in `packages/harness/src/agentMode.ts` is a
    fixed string; only `url` interpolated; "do not follow off-origin
    links" written into the prompt. All other LLM calls in the
    system (verifiers, arbiter, gate Flash escalation) DO route
    through Lobster Trap via `@scout/llm-client`.
  - **SDK shape correction** (locked 2026-05-15) — `browser-use-sdk@3.6.0`
    has a flat resource surface (`client.browsers.*`,
    `client.sessions.*`, `client.tasks.*`). References to
    `client.v2.*` in `features/clusterB/harness-capture-page.md:48`
    and `PRPs/foundation-ad-verification.md:28, 217-219` are
    superseded.

  ### Task 6 — Full validation sweep

  ```bash
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r exec prettier --write .
  pnpm -r test
  pnpm -r build
  pnpm audit
  # Manual (requires BROWSER_USE_API_KEY):
  pnpm --filter @scout/harness run smoke
  ```

  The smoke must show:
  - URL 1 (static article) → `mode: "browser"`
  - URL 2 (SPA) → `mode: "browser"`
  - URL 3 (video-heavy) → `mode: "browser"`, ≥1 video sample
  - URL 4 (consent-wall) → `mode: "agent"`, fallback warning present

  ## Security guardrails

  - **`safeParse` already pinned upstream** (PRP-B2 + PRP-C1); `capture.ts`
    just routes — does not produce new shapes.
  - **Fail-closed two-pass** — T1d + T1e pin that `TIMEOUT` /
    `NAVIGATION_FAILED` do NOT retry. T1f pins both-modes-failed
    throws, never silently emits.
  - **No new env access** — `capture.ts` and `factory.ts` rewire only;
    no new `process.env.*` calls. Re-verify with `grep -rn
    'process\.env' packages/harness/src` (Task 6).
  - **Documentation as guardrail** — the README's sponsor-tech
    exception section is the durable record of why one specific path
    is the bypass. Future refactor pressure cannot delete the
    exception without first removing the README paragraph; that's
    the social contract.

  ## Out of scope (file as follow-ups)

  - Self-host install / serve scripts (D7 references this; separate PRP).
  - Mobile-viewport capture, multi-region capture, PDF rendering,
    S3/GCS evidence storage, perceptual hashing, concurrent capture —
    all v1-out-of-scope items from
    `features/clusterB/harness-capture-page.md:171-182`.
  - Update the FEATURE-TODO.md row (`harness-capture-page.md`) to
    reflect the 5-PRP split — non-trivial; file a doc PR after this
    one lands.

  ## Anti-Patterns

  - ❌ Retry via Agent on `TIMEOUT`. T1d pin.
  - ❌ Silently emit a partial `PageCapture` when both modes fail.
    T1f pin.
  - ❌ Drop the README. The agent-mode exception must be in source
    where future readers find it.
  - ❌ Drop the CLAUDE.md update. The file's update protocol is
    explicit; skipping it means the next reader re-derives.
  - ❌ Push the `consent_wall_handled_via_agent_mode` warning on a
    `forceAgentMode: true` path. T1g pin — forced direct ≠ fallback.
  - ❌ Add a Browser-mode consent-wall *dismissal*. The architecture
    keeps detection (Browser) and dismissal (Agent) separate; splitting
    that crosses a seam.

  ## Confidence: 8 / 10

  Small, composable orchestrator over already-green primitives. The
  README + CLAUDE.md edits are doc tasks but they close the social-
  contract loop on the agent-mode exception — without them the next
  refactor wipes the bypass without realizing it.

  Risk: the consent-wall URL in the smoke script (Task 3) needs to be
  picked carefully — pages move; a once-walled URL may stop walling.
  Document the date the URL was verified walled in the smoke script
  comment so a future failure tells the reader "the URL drifted,
  not the code."
