name: "Demo — PRP-C: Scenarios 1+2 + orchestrator (TDD)"
description: |

  Third of five PRPs for `features/clusterD/demo-bidstream-seeding.md`.
  Lands scenarios 1 (clean ALLOW) + 2 (clean DENY) — baseline pace
  setters (feature 19–29) — plus orchestrator (`run-demo.ts`) and
  inter-scenario reset (`clear-state.ts`). Tests against PRP-B's
  in-process gate, asserts determinism (85), pins clear-state contract
  (152–158, opt C; tests 73–88; paths 56–67).

  **Prereqs**: PRP-A (`ScenarioSchema`, `ExpectationSchema`,
  `DEMO_GATE_URL`); PRP-B (`replayer`, `seeder`, `asserts`,
  `inProcessGate`). **Follow-ups**: PRP-D (3+4 + LLM mock); PRP-E
  (5+6 + hit-rate).

  ## TDD discipline

  Red → green → refactor per task. Fixture parse-tests first; scenarios
  green one at a time; determinism + clear-state pin cross-scenario
  invariants last. `vi.mock` per-test; PRP-B's `inProcessGate` is the
  rig, NOT a mock. The gate's stub `LlmClient` throws on `chat()` (OK —
  scenarios 1+2 never call Flash).

  ## Why this PRP exists separately

  Unblocks D+E: scenario set grows 2→4→6. The orchestrator is generic
  over `scenarios[]`; D+E just author fixtures + drop into the array.
  Inter-scenario `clearState()` is generic — fresh gate per scenario, so
  D's Flash mock can't leak into E's cache-miss test, and E's queue spy
  can't leak back into D's verdict assertion. Scenarios 1+2 are the
  baseline: zero LLM, zero Lobster Trap, `latencyMs < 300`. Submission
  video opens with these; if scenario 1 flakes, the demo collapses
  (feature 211).

  ## Hackathon constraint check

  - **Sub-second SLA.** Scenarios 1+2 assert `latencyMs < 300ms` per
    `expectations[].latencyMsMax` (feature 22, 28) — the headline
    performance claim.
  - **Pre-bid.** Replayer drives `POST /verify` synchronously; verdict
    gates the bid. Honored.
  - **Plug-and-play.** Scenarios are pure JSON; orchestrator iterates
    `scenarios[]`; D+E grow the array without touching `runScenario` /
    `runAllScenarios` / `run-demo.ts`.
  - **Sponsor tech.** Scenarios 1+2 are *zero-LLM on the hot path*
    (feature 29) — they establish the baseline against which scenario 3
    (Gemini Flash) and scenario 5 (Gemini Pro × 4 warm-path) show off.
    `lobstertrapTraceId` asserted `null` pins fast path never touches
    Lobster Trap.

  ## CLAUDE.md rules that bite

  - **§ Working agreements** — files ≤ ~300 lines. `run-demo.ts` ≤ 120;
    `runScenario.ts` ≤ 150; `clear-state.ts` ≤ 60. Tests co-located.
  - **§ Stack** — `tsx` added as **devDep** for the CLI; flag in PR
    description (ask-before-dep). No new runtime dep.
  - **§ Working agreements** — no emojis in CLI output. ASCII
    `[OK]` / `[FAIL]` only.
  - **§ Stack** — fixture JSON parses through PRP-A's `ScenarioSchema`
    + `PageProfileSchema` at load. A typo fails CI, not the demo.

  ## Decisions (locked here)

  | # | Question | Locked |
  |---|---|---|
  | D1 | `run-demo.ts` default mode | `realtime` (stage; feature 91). `accelerated` opt-in via `--mode accelerated`. |
  | D2 | `--pause-ms` default | `3000` realtime (feature 91); `accelerated` overrides to `0`. |
  | D3 | State-clear approach | **Re-instantiate** `createStores()` per scenario; do NOT add `clear()` to `@scout/store`. Re-bind into a fresh `inProcessGate`. No cross-package edit. |
  | D4 | Health-check shape | `POST ${DEMO_GATE_URL}/verify` with `{}`, expect 400 (zod-reject). No gate edit needed (no `/health` route). Feature 189: *"never silently fail-soft."* |
  | D5 | Advertiser ID convention | Match policy fixture verbatim. Scenario 1 → `advertiser-news`; scenario 2 → `advertiser-family-safe`. |
  | D6 | ULID-shaped IDs | Synthetic ULID-like strings (`creative-01HMXY8K9D3J5RBQVAW4N7TZP2`) per feature 174. |
  | D7 | CLI output | ASCII only: `[OK]`, `[FAIL]`. One line per scenario: `[OK] 01-clean-allow ALLOW (latency 47ms)`. |
  | D8 | First-failure behavior | **Continue + collect.** Log `[FAIL]`, run rest, exit non-zero with final tally. Demo runners see the full picture. |
  | D9 | `PageProfile.url` ↔ `BidVerificationRequest.pageUrl` | Byte-equal. `@scout/store` keys on `profile.url` (`packages/store/src/index.ts:71`); a trailing-slash mismatch silently turns ALLOW into cache-miss DENY. Parse-tests pin. |
  | D10 | `contentHash` convention | 8-char slug (`news-2026-05`, `gamble-atlc01`). Not a real SHA. |

  ## All Needed Context

  ```yaml
  - file: features/clusterD/demo-bidstream-seeding.md
    section: "Scenarios 1+2 19-29; paths 56-67; tests 73-88; determinism
      85-87; modes 89-94; cache-state 152-158 (opt C); URL shape 174;
      test order 211-223"
  - file: PRPs/clusterD/demo-bidstream-seeding/demo-package-foundation.md     # Prereq A
  - file: PRPs/clusterD/demo-bidstream-seeding/demo-replayer-seeder-asserts.md # Prereq B
  - file: PRPs/clusterD/demo-bidstream-seeding/DEMO-BIDSTREAM-SEEDING-TODO.md
  - file: PRPs/clusterB/profiler-real-loop/profiler-core-loop.md             # style template
  - file: packages/policy/fixtures/brand-safe-news.json                      # scenario 1
  - file: packages/policy/fixtures/gambling-strict.json                      # scenario 2
  - file: packages/shared/src/schemas/profile.ts                             # ttl is SECONDS
  - file: packages/shared/src/schemas/bid.ts
  - file: packages/shared/src/schemas/verdict.ts
  - file: packages/store/src/index.ts                                        # createStores()
  - file: CLAUDE.md
  ```

  ## Files to create / modify

  **Create**:
  ```
  packages/demo/fixtures/scenarios/{01-clean-allow,02-clean-deny}.json
  packages/demo/fixtures/pages/{news-site,gambling-page}.profile.json
  packages/demo/src/runScenario.ts                   (≤ 150 lines)
  packages/demo/src/__tests__/{runScenario,scenario-01,scenario-02,
                               determinism,clear-state,run-all}.test.ts
  packages/demo/scripts/run-demo.ts                  (≤ 120 lines)
  packages/demo/scripts/clear-state.ts               (≤ 60 lines)
  ```
  **Modify**: `packages/demo/src/index.ts` (append `export { runScenario,
  runAllScenarios }`); `packages/demo/package.json` (`"demo": "tsx
  scripts/run-demo.ts"` + `tsx` devDep).

  ## Target fixture content

  **`packages/demo/fixtures/scenarios/01-clean-allow.json`**:
  ```json
  {
    "formatVersion": "1.0",
    "name": "01-clean-allow",
    "description": "Fast cache-hit ALLOW for a brand-safe news page. Zero LLM round-trip, sub-300ms.",
    "seeds": { "profiles": ["news-site"], "policies": ["brand-safe-news"] },
    "bids": [{ "delayMs": 0, "request": {
      "advertiserId": "advertiser-news",
      "policyId": "policy-brand-safe-news",
      "pageUrl": "https://example.com/news/2026-05-18-headline",
      "creativeRef": "creative-01HMXY8K9D3J5RBQVAW4N7TZP2",
      "geo": "US",
      "ts": "2026-05-18T10:00:00.000Z"
    }}],
    "expectations": [{
      "decision": "ALLOW",
      "reasonKinds": ["profile_signal", "policy_rule"],
      "latencyMsMax": 300,
      "lobstertrapTraceIdNullable": true
    }]
  }
  ```

  **`packages/demo/fixtures/scenarios/02-clean-deny.json`**:
  ```json
  {
    "formatVersion": "1.0",
    "name": "02-clean-deny",
    "description": "Fast cache-hit DENY for a gambling page under family-safe policy. Same fast path, opposite verdict.",
    "seeds": { "profiles": ["gambling-page"], "policies": ["gambling-strict"] },
    "bids": [{ "delayMs": 0, "request": {
      "advertiserId": "advertiser-family-safe",
      "policyId": "policy-gambling-strict",
      "pageUrl": "https://example.com/casino/atlantic-city",
      "creativeRef": "creative-01HMXY8K9D3J5RBQVAW4N7TZP3",
      "geo": "US",
      "ts": "2026-05-18T10:00:03.000Z"
    }}],
    "expectations": [{
      "decision": "DENY",
      "reasonKinds": ["policy_rule"],
      "latencyMsMax": 300,
      "lobstertrapTraceIdNullable": true
    }]
  }
  ```

  **`packages/demo/fixtures/pages/news-site.profile.json`**:
  ```json
  {
    "id": "profile-news-site-01HMXY8K9D3J5RBQVAW4N7TZP4",
    "url": "https://example.com/news/2026-05-18-headline",
    "contentHash": "news-2026-05",
    "categories": [{ "label": "news", "confidence": 0.94 }],
    "detectedEntities": [], "evidenceRefs": [],
    "capturedAt": "2026-05-18T09:59:00.000Z", "ttl": 21600
  }
  ```

  **`packages/demo/fixtures/pages/gambling-page.profile.json`**:
  ```json
  {
    "id": "profile-gambling-page-01HMXY8K9D3J5RBQVAW4N7TZP5",
    "url": "https://example.com/casino/atlantic-city",
    "contentHash": "gamble-atlc01",
    "categories": [{ "label": "gambling", "confidence": 0.91 }],
    "detectedEntities": [], "evidenceRefs": [],
    "capturedAt": "2026-05-18T09:59:30.000Z", "ttl": 21600
  }
  ```

  ## Target contracts — runScenario, runAllScenarios, clearState, runDemo CLI

  ```ts
  // src/runScenario.ts
  import type { Scenario } from "./schemas/scenario.js";           // PRP-A
  import type { InProcessGate } from "./testRig/inProcessGate.js"; // PRP-B
  import type { VerificationVerdict } from "@scout/shared";

  export interface RunScenarioOpts { gate: InProcessGate; }
  export interface AssertFailure { bidIndex: number; message: string; }
  export interface ScenarioResult {
    name: string; ok: boolean;
    verdicts: VerificationVerdict[]; latenciesMs: number[];
    failures: AssertFailure[];
  }
  export async function runScenario(
    scenario: Scenario, opts: RunScenarioOpts,
  ): Promise<ScenarioResult>;

  export interface RunAllOpts {
    bootGate: () => Promise<InProcessGate>;
    teardownGate: (g: InProcessGate) => Promise<void>;
    onStateClear?: () => void;            // spy hook for run-all.test.ts
    interScenarioPauseMs?: number;        // 3000 realtime, 0 accelerated
  }
  export async function runAllScenarios(
    scenarios: Scenario[], opts: RunAllOpts,
  ): Promise<ScenarioResult[]>;           // ALL scenarios run; check `r.ok`

  // scripts/clear-state.ts  (D3: re-instantiate + rebind, NOT clear())
  export async function clearState(
    current: InProcessGate,
    bootGate: () => Promise<InProcessGate>,
    teardown: (g: InProcessGate) => Promise<void>,
  ): Promise<InProcessGate>;

  // scripts/run-demo.ts — CLI; --mode, --pause-ms, --gate-url; D4
  // health-check; loads fixtures; runAllScenarios; D7 summary;
  // exit(failureCount ? 1 : 0).
  ```

  ## Task order (TDD; commit-sized)

  ### Task 1 — Fixtures + parse-tests
  Red: `runScenario.test.ts` parses scenarios 1+2 through
  `ScenarioSchema`; parses page profiles through `PageProfileSchema`;
  parses policies through `PolicySchema`. Green: drop the four JSON
  files from § Target fixture content verbatim. **D9 cross-check**:
  parse-test asserts `bids[0].request.pageUrl === profile.url` both
  scenarios.

  ### Task 2 — `runScenario.ts` happy-path (scenario 1)
  Red: `__tests__/scenario-01.test.ts` boots PRP-B's `inProcessGate`,
  seeds via `seedScenario`, calls `runScenario(scenario1)`; asserts
  `result.ok`, `decision === "ALLOW"`, `reasons.map(r => r.kind)`
  deep-equals `["profile_signal", "policy_rule"]`, `latenciesMs[0] <
  300`, `lobstertrapTraceId === null`. Green: implement `runScenario.ts`
  — for each bid, optional delay, call `replayer.fire`, call
  `assertVerdict`, collect results. ≤ 150 lines.

  ### Task 3 — Scenario 2 (DENY)
  Red: `__tests__/scenario-02.test.ts` mirrors 01 but asserts `DENY`,
  `reasonKinds: ["policy_rule"]`, latency < 300. Fresh gate. Green: no
  new impl. Surfaces the case-sensitivity gotcha (lowercase `"gambling"`
  matches policy's `"gambling"`).

  ### Task 4 — Determinism (feature 85)
  Red: `__tests__/determinism.test.ts` runs scenario 1 twice (fresh gate
  each), then scenario 2 twice; asserts identical `decision`, identical
  `reasons.map(r => r.kind)` order, identical `profileId`; latency may
  differ but stays `< 300ms`. Green: no new impl. Failure ⇒ hidden state.

  ### Task 5 — `clearState` + pin (feature 152–158, opt C)
  Red: `__tests__/clear-state.test.ts` boots gate-A, seeds scenario 1's
  profile, asserts `profileStore.get(url) !== null`; calls `clearState`
  → gate-B; asserts on gate-B `profileStore.get(url) === null`.
  Green: `scripts/clear-state.ts` exports `clearState` which calls
  `teardown(current)` then `bootGate()`. ≤ 60 lines. **No `@scout/store`
  edit** — re-instantiate, don't clear.

  ### Task 6 — `runAllScenarios` + run-all test
  Red: `__tests__/run-all.test.ts` calls `runAllScenarios([s1, s2], {
  bootGate, teardownGate, onStateClear: spy, interScenarioPauseMs: 0 })`;
  asserts both `ok`, `spy` called exactly once. Green: iterate; for
  index i, run; if i < N-1, `clearState` + invoke `onStateClear`; pause
  between. Export both from `src/index.ts` barrel.

  ### Task 7 — `run-demo.ts` CLI + manual smoke
  No automated test; manual smoke. Add `package.json` script + `tsx`
  devDep. Implement: parse `--mode realtime|accelerated` (default
  realtime), `--pause-ms <n>` (3000), `--gate-url <url>` (default
  `DEMO_GATE_URL` env → `http://localhost:3000`). Health-check (D4):
  `POST ${gateUrl}/verify` with `{}`, expect 400; on non-400/fetch-error
  → `[FAIL] gate unreachable` + `exit(1)`. Load both fixtures from
  `fixtures/scenarios/`, parse via `ScenarioSchema`, call
  `runAllScenarios` with `interScenarioPauseMs: mode === "accelerated"
  ? 0 : pauseMs`. One line per result per D7. Tally: `2/2 scenarios
  passed in 6.04s`. `exit(failureCount ? 1 : 0)`. Smoke: `pnpm --filter
  @scout/demo demo --mode accelerated` expect two `[OK]` + exit 0 under
  10s. Verify loud-fail: stop gate, re-run, expect `[FAIL]` + exit 1.

  ### Task 8 — Validation gates
  Run full sweep below. Pin file caps with `wc -l`. Pin no-emoji.

  ## Validation gates (executable)

  ```bash
  pnpm --filter @scout/demo test
  pnpm -r exec tsc --noEmit && pnpm -r exec eslint . --fix
  pnpm -r build && pnpm audit
  # Manual smoke (gate running):
  pnpm --filter @scout/demo demo --mode accelerated
  # Expected: [OK] 01-clean-allow ALLOW (latency Xms)
  #           [OK] 02-clean-deny  DENY  (latency Xms)
  #           2/2 scenarios passed in Ys
  wc -l packages/demo/src/runScenario.ts        # ≤ 150
  wc -l packages/demo/scripts/run-demo.ts       # ≤ 120
  wc -l packages/demo/scripts/clear-state.ts    # ≤ 60
  grep -Pn '[\x{1F300}-\x{1FAFF}]' packages/demo/src packages/demo/scripts \
    || echo "no emojis - good"
  ```

  ## Security guardrails

  - **Fixture grep gate** (PRP-A pinned; reaffirm): `grep -r
    "API_KEY\|secret\|bearer" packages/demo/fixtures/` returns nothing.
  - **`example.com`-only URLs** in seeded `PageProfile.url` and
    `pageUrl` (feature 174). No real publisher domains.
  - **No `process.env.*`** outside PRP-A's `src/config.ts`. CLI reads
    `DEMO_GATE_URL` through `config.ts`.
  - **No outbound network** beyond the configured gate URL. Test rig is
    `inProcessGate`.
  - **Single-tenant per scenario**: PRP-B validates all bids carry the
    same `advertiserId`; scenarios 1+2 honor trivially.

  ## Gotchas

  1. **`PageProfile.ttl` is SECONDS** (feature 100, schema line 30).
     Encode `21600` (6 h), not `21600000`.
  2. **`categories[].label` case-sensitivity** must match policy's
     `rules[].match` exactly. Fixtures use lowercase (`"news"`,
     `"gambling"`); a drift silently turns ALLOW into cache-miss DENY.
  3. **`PageProfile.url` ↔ `BidVerificationRequest.pageUrl`** byte-equal
     (D9). `@scout/store` keys on `profile.url` alone
     (`packages/store/src/index.ts:71`); trailing-slash mismatch
     silently turns ALLOW into cache-miss DENY. Parse-test pins.
  4. **In-process gate runs on ephemeral port** (PRP-B rig);
     `run-demo.ts`'s `DEMO_GATE_URL` default (`http://localhost:3000`)
     points at the production gate. Tests use `inProcessGate.url`; CLI
     uses env default. Intentionally different.
  5. **Clear-state is re-instantiate, not `clear()`** (D3). No
     non-existent `profileStore.clear()`.
  6. **Health-check is `POST /verify` with `{}` → 400** (D4), not
     `GET /health` (no such route). When foundation adds one, PRP-E
     swaps.
  7. **`--mode realtime` is default** (D1). Vitest passes
     `interScenarioPauseMs: 0` so the suite stays fast.
  8. **`tsx` is devDep, NOT runtime.** Production deploys via `pnpm -r
     build`.
  9. **Continue-on-failure (D8)** — scenario-1 fail does NOT skip
     scenario-2. Exit non-zero, both `[FAIL]` lines visible.

  ## Out of scope — file as follow-ups

  - **Scenarios 3 + 4** + `--llm=real|mock` + `llmMock.ts` → PRP-D.
  - **Scenarios 5 + 6** + `waitForProfile` + `assertHitRate` +
    `zipfian` → PRP-E.
  - **`packages/policy/fixtures/politics-borderline.json`** → PRP-D.
  - **`--preserve-recorded-ts` flag** (feature gotcha 188) → PRP-B.
  - **WebSocket streaming, fixture-authoring UI, live-DPI-catch
    scenario** (feature *Out of scope* 201, 205, 209).
  - **`GET /health` route on the gate** — when foundation adds, swap D4.

  ## Anti-Patterns

  - **No parallel scenario fan-out.** Orchestrator runs sequentially
    (feature 91); parallel breaks the determinism contract.
  - **Do NOT add `clear()` to `@scout/store`** (D3). Re-instantiate is
    the contract; `clear()` is a cross-package edit creating a second
    seam.
  - **No emojis in CLI output** (CLAUDE.md). ASCII only.
  - **Do NOT author scenarios 3-6 here.** PRP-D and PRP-E own them.
  - **Do NOT `vi.mock("@scout/llm-client")`.** Scenarios 1+2 never call
    Flash; PRP-B's stub that throws on `chat()` is correct. PRP-D mocks.
  - **Do NOT introduce a global `__SCENARIO_STATE__`** or module-level
    mutable state in `runScenario.ts`. Determinism test (Task 4) guards.
  - **Do NOT skip the `gate unreachable` failure path** (feature 189).
    Green CLI exit against an unreachable gate is the worst silent fail.
  - **Do NOT short-circuit on first failure** (D8). Collect all, report
    all, exit non-zero with tally.

  ## Confidence: 8 / 10

  Strengths: two end-to-end happy paths against the *real* gate handler
  (PRP-B's `inProcessGate`, no mocks inside the gate); determinism test
  (Task 4) catches the largest class of stage flake; clear-state
  contract (Task 5) is the load-bearing invariant for D+E, pinned early;
  orchestrator's `scenarios[]` is trivially extensible.

  Risks:
  - **R1 — PRP-B shape drift.** Consumes `inProcessGate.url` /
    `seedScenario` / `replayer.fire` / `assertVerdict`; rename breaks
    callsites. Lock PRP-B first.
  - **R2 — Health-check (D4).** `POST /verify` with `{}` → 400 depends
    on gate's zod behavior; if gate coerces `{}` to partial, status
    differs. Manual smoke catches.
  - **R3 — `tsx` devDep.** Ask-before-dep; fallback `tsc` + `node dist`.
  - **R4 — `ProfileStore` keys on URL alone**
    (`packages/store/src/index.ts:71`). If foundation switches to
    `(advertiserId, contentHash)`, URL-keyed lookup still works; D9 +
    parse-test guard.
  - **R5 — `clearState` re-instantiation** is the novel piece. Callers
    thread `bootGate` + `teardownGate` consistently; run-all.test.ts +
    CLI reuse single-source it.
