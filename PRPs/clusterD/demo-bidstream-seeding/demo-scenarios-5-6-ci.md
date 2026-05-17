name: "Demo — PRP-E: scenarios 5+6 + npm scripts + submission-grade sweep (TDD)"
description: |

  Fifth and **final** PRP for `features/clusterD/demo-bidstream-seeding.md`.
  Capstone of the 5-PRP cluster. Ships scenario 5 (cache-miss DENY → profile
  warms async → second bid hits — `features/architecture.md:32-37` made
  executable), CI-only scenario 6 (200-req Zipfian hit-rate sweep, folds in
  cross-cutting *Cache hit-rate validation* per `FEATURE-TODO.md:106-108`),
  npm scripts, and the submission-grade validation sweep.

  **Owned feature lines:** 43-48, 50-54, 73-88 (esp. 81-83), 89-94, 165-168,
  187-198 (esp. 191 poll-not-sleep, 196 threshold), 211-223. Plus
  `features/architecture.md:32-37`.

  **Prereqs (all merged):** PRP-A foundation (EDITS `src/types.ts` additively
  Task 1); PRP-B replayer/seeder/asserts/in-process gate; PRP-C
  `runScenario.ts`+scripts (EDITS Task 7, 11); PRP-D `--llm` flag + `llmMock.ts`
  (CONSUMES `--llm`/`--mode`).

  ## TDD discipline

  Red → Green → Refactor. Correct-reason red. Minimum impl. Commit at green.
  Order: schema (1) → pure helpers (2-4) → fixtures (5-6) → `runScenario` (7)
  → scenario tests (8-10) → orchestrator (11) → ordering (12) → npm scripts
  (13) → validation (14) → cluster done-criteria (15). PRP-A/C edits MUST
  keep their tests green.

  ## Why this PRP exists separately

  - **Capstone.** Only PRP whose end state is "judges see product working end-to-end."
  - **Folds in *Cache hit-rate validation***. Same format + replayer; scenario 6 = CI gate, not stage cut.
  - **Only timing-sensitive interaction in cluster** — phase A → phase B wait. Biggest stage-flake guard (feature 191).
  - **Cluster done-criteria** — Task 15 ticks the cluster checklist.

  ## Hackathon constraint check

  - **Sub-second SLA** — phase A `latencyMs<100` (fail-fast on miss is the headline; feature 47, `architecture.md:32`); phase B `latencyMs<300` (warm-then-hit recovery). Replayer does NOT extend SLA.
  - **Pre-bid** — both phases HTTP-from-outside; gate's `setImmediate` enqueue (`handler.ts:49`) post-`reply.send()`; replayer never observes warm path.
  - **Plug-and-play** — scenarios 5+6 are pure JSON. `phases[]` schema is the reusable seam. Three pure helpers exported.
  - **Sponsor tech — BOTH** (feature 48). Scenario 5 phase A is the one scenario where Gemini Pro (warm verifiers × 4) AND Lobster Trap DPI (per LLM call) BOTH get exercised when `--llm=real`. `--llm=mock` keeps wire shape identical for stage.

  ## CLAUDE.md rules that bite

  - **300-line file cap.** `waitForProfile.ts` ≤60, `assertHitRate.ts` ≤50, `zipfian.ts` ≤60, `generate-sweep-pages.ts` ≤50, tests ≤200.
  - **Zero new runtime deps.** `zipfian.ts` hand-rolled (mulberry32 inlined).
  - **§ Update protocol** — Task 15 lands cluster's final § Stack bullet.
  - **Tests colocated.** Each helper: 1 happy + 1 edge + 1 failure.

  ## Decisions (locked here)

  | # | Question | Locked answer |
  |---|---|---|
  | D1 | Two-phase shape | `phases?: PhaseSchema[]` on `ScenarioSchema`, **mutually exclusive** with `bids?` via `.refine`. Each phase: own `bids[]`+`expectations[]`+optional `preconditions` (`{clearProfileStore:true}` or `{putProfile:"fresh-tech-blog"}`)+optional `postWait` hook id (`"waitForProfile"`). |
  | D2 | `waitForProfile` defaults | `timeoutMs:60000`, `pollIntervalMs:500`. Fails LOUD on timeout. Feature 191. |
  | D3 | Why poll, not sleep | Profiler commit takes 10-60s on Pro response time; fixed sleep either delays or misses. Polling `ProfileStore.get(url)` is the only correct shape. |
  | D4 | `assertHitRate` signal | `reasons.some(r => r.kind==="fail_closed" && r.ref==="cache_miss")` = MISS; absence = HIT. Operates on received verdicts — NEVER gate logs. Feature 190. |
  | D5 | Initial threshold | **0.75** in fixture (`expectations.hitRateMin`), NOT code. Tune from first real run. Feature 196 + TODO § 5. |
  | D6 | Zipfian defaults | `alpha:1.0`, 20 pages × 200 reqs (feature 52). Deterministic mulberry32. |
  | D7 | Sweep mode discriminator | Optional `mode?:"stage"|"hit-rate-sweep"` on `ScenarioSchema` (default `"stage"`). `runScenario` branches: sweep calls `assertHitRate` instead of `assertVerdict`. |
  | D8 | Scenario 6 test gating | `test.skip` in default `pnpm test` (feature 83); runs in `pnpm test:long` via `--testNamePattern "hit-rate"`. |
  | D9 | Sweep-page authorship | Generator script AND 20-file output BOTH committed. 5 hand-curated warm + 15 generated tail. |
  | D10 | fresh-tech-blog shape | `categories:[{label:"technology",confidence:0.88}]`, `evidenceRefs:[]`, `ttl:21600` (SECONDS — feature 100). Rig manually `profileStore.put` (feature 109 — decouples from profiler). |
  | D11 | Phase-A spy | Exactly one `ProfileQueue.enqueue` with the four pinned fields `{url, advertiserId, policyId, requestedAt}` (`store/src/index.ts:38`). Wraps `createStores()` queue. |
  | D12 | Accelerated cap | <60s for FULL 5-scenario sweep (feature 92), NOT per scenario. |
  | D13 | Inter-scenario clear | PRP-C's `clear-state.ts` runs between; Task 12 pins `profileStore.get(scenario5.pageUrl)===null` immediately before phase A. |

  ## All Needed Context

  ```yaml
  - file: features/clusterD/demo-bidstream-seeding.md
    section: "43-48, 50-54, 73-88, 89-94, 165-168, 187-198, 211-223"
  - file: features/architecture.md
    section: "32-37"
    why: Cache-miss DENY-then-warm narrative — scenario 5 made executable.
  - file: PRPs/clusterD/demo-bidstream-seeding/demo-package-foundation.md
    why: PRP-A. ScenarioSchema; additively extended.
  - file: PRPs/clusterD/demo-bidstream-seeding/demo-replayer-seeder-asserts.md
    why: PRP-B. Replayer/seeder/asserts/in-process gate.
  - file: PRPs/clusterD/demo-bidstream-seeding/demo-scenarios-1-2-orchestrator.md
    why: PRP-C. runScenario.ts + run-demo.ts; additively edited.
  - file: PRPs/clusterD/demo-bidstream-seeding/DEMO-BIDSTREAM-SEEDING-TODO.md
    section: "§ Cross-PRP coordination 4-5; § Done criteria"
  - file: PRPs/clusterB/profiler-real-loop/profiler-tenant-shutdown-smoke.md
    why: STYLE TEMPLATE — capstone of 5-PRP cluster.
  - file: packages/gate/src/handler.ts
    section: "1-70"
    why: Cache-miss returns Reason{fail_closed,cache_miss} + setImmediate enqueues.
  - file: packages/store/src/index.ts
    why: ProfileQueue + ProfileJob shape; spy target.
  - file: packages/shared/src/schemas/verdict.ts
    why: Reason.kind vocabulary.
  - file: packages/shared/src/schemas/profile.ts
    why: PageProfileSchema — all fixtures round-trip.
  - file: CLAUDE.md
    section: "§ Stack; § Update protocol; 300-line cap"
  ```

  ## Files to create / modify

  **Create:** `fixtures/scenarios/{05-cache-miss-deny-then-warm,06-cache-hitrate-sweep}.json`; `fixtures/pages/fresh-tech-blog.profile.json`; `fixtures/pages/sweep-page-{01..20}.profile.json` (5 hand + 15 generated); `src/{waitForProfile,assertHitRate,zipfian}.ts` (≤60/≤50/≤60); `scripts/generate-sweep-pages.ts` (≤50, one-shot); `src/__tests__/{waitForProfile,assertHitRate,zipfian,scenario-05-phaseA,scenario-05-phaseB,scenario-06,run-all-ordering}.test.ts` (scenario-06 = `test.skip`).

  **Modify (EDIT — no parallel call sites):** `src/types.ts` (additive `PhaseSchema`/`phases?`/`mode?`/`expectations[].reasonRefs?`); `src/runScenario.ts` (branch on `phases` and `mode==="hit-rate-sweep"`); `scripts/run-demo.ts` (add 03-05; `--scenario 06` flag; accelerated cap on 5-scenario sum); `src/index.ts` (barrel 3 helpers); `packages/demo/package.json` (npm scripts Task 13); root `package.json` (`"demo":"pnpm --filter @scout/demo run demo"`); `CLAUDE.md` (cluster bullet Task 15).

  **Do NOT create:** separate `cache-hitrate-validation.md` (folded); `phaseRunner.ts` (inline in `runScenario.ts`); `--scenario 5 --phase A` CLI.

  ## Target fixture content

  ### `05-cache-miss-deny-then-warm.json`

  ```json
  {
    "formatVersion": "1.0",
    "name": "05-cache-miss-deny-then-warm",
    "description": "Cache miss DENYs now; profile warms async; second bid hits ALLOW.",
    "mode": "stage",
    "seeds": { "profiles": [], "policies": ["brand-safe-news"] },
    "phases": [
      { "name": "phaseA-cache-miss-deny", "preconditions": { "clearProfileStore": true },
        "bids": [{ "delayMs": 0, "request": { "advertiserId": "advertiser-demo-01", "policyId": "brand-safe-news", "pageUrl": "https://example.com/fresh-tech-blog", "creativeRef": "creative-01HMXYZAAAAAAAAAAAAAAAAAAA", "geo": "US", "ts": "2026-05-19T17:00:00.000Z" } }],
        "expectations": [{ "decision": "DENY", "reasonKinds": ["fail_closed"], "reasonRefs": ["cache_miss"], "latencyMsMax": 100, "lobstertrapTraceIdNullable": true }],
        "postWait": "waitForProfile" },
      { "name": "phaseB-warm-then-hit", "preconditions": { "putProfile": "fresh-tech-blog" },
        "bids": [{ "delayMs": 0, "request": { "advertiserId": "advertiser-demo-01", "policyId": "brand-safe-news", "pageUrl": "https://example.com/fresh-tech-blog", "creativeRef": "creative-01HMXYZBBBBBBBBBBBBBBBBBBB", "geo": "US", "ts": "2026-05-19T17:00:30.000Z" } }],
        "expectations": [{ "decision": "ALLOW", "reasonKinds": ["profile_signal", "policy_rule"], "latencyMsMax": 300, "lobstertrapTraceIdNullable": true }] }
    ]
  }
  ```

  ### `06-cache-hitrate-sweep.json` (3 of 200 shown; rest generated)

  ```json
  {
    "formatVersion": "1.0", "name": "06-cache-hitrate-sweep",
    "description": "200-req Zipfian; warm top-5 only; hit-rate >= 0.75.",
    "mode": "hit-rate-sweep",
    "seeds": { "profiles": ["sweep-page-01","sweep-page-02","sweep-page-03","sweep-page-04","sweep-page-05"], "policies": ["brand-safe-news"] },
    "bids": [
      { "delayMs": 0, "request": { "advertiserId": "advertiser-sweep-01", "policyId": "brand-safe-news", "pageUrl": "https://example.com/sweep/01", "creativeRef": "creative-sweep-0001", "geo": "US", "ts": "2026-05-19T17:01:00.000Z" } },
      { "delayMs": 0, "request": { "advertiserId": "advertiser-sweep-01", "policyId": "brand-safe-news", "pageUrl": "https://example.com/sweep/01", "creativeRef": "creative-sweep-0002", "geo": "US", "ts": "2026-05-19T17:01:00.050Z" } },
      { "delayMs": 0, "request": { "advertiserId": "advertiser-sweep-01", "policyId": "brand-safe-news", "pageUrl": "https://example.com/sweep/02", "creativeRef": "creative-sweep-0003", "geo": "US", "ts": "2026-05-19T17:01:00.100Z" } }
    ],
    "expectations": [{ "hitRateMin": 0.75 }]
  }
  ```

  > 197 more bids generated by `zipfian({nPages:20,nRequests:200,alpha:1.0,seed:42})` and inlined at fixture-author time. Commit the full file.

  ### `fresh-tech-blog.profile.json` + `sweep-page-01.profile.json`

  ```json
  { "id": "profile-fresh-tech-blog-01", "url": "https://example.com/fresh-tech-blog", "contentHash": "sha256-fresh-tech-blog-01", "categories": [{ "label": "technology", "confidence": 0.88 }], "detectedEntities": [], "evidenceRefs": [], "capturedAt": "2026-05-19T17:00:25.000Z", "ttl": 21600 }
  ```
  ```json
  { "id": "profile-sweep-page-01", "url": "https://example.com/sweep/01", "contentHash": "sha256-sweep-page-01", "categories": [{ "label": "news", "confidence": 0.92 }], "detectedEntities": [], "evidenceRefs": [], "capturedAt": "2026-05-19T16:00:00.000Z", "ttl": 21600 }
  ```

  ## Target contracts

  ```ts
  // waitForProfile.ts (<= 60)
  export class WaitForProfileTimeoutError extends Error {
    constructor(public readonly url: string, public readonly timeoutMs: number) {
      super(`waitForProfile timed out after ${timeoutMs}ms for ${url}`);
      this.name = "WaitForProfileTimeoutError";
    }
  }
  export interface WaitForProfileOptions { timeoutMs?: number; pollIntervalMs?: number; clock?: () => number; }
  export async function waitForProfile(profileStore: ProfileStore, url: string, opts?: WaitForProfileOptions): Promise<PageProfile>;

  // assertHitRate.ts (<= 50)
  export function isCacheMiss(v: VerificationVerdict): boolean {
    return v.reasons.some(r => r.kind === "fail_closed" && r.ref === "cache_miss");
  }
  export function assertHitRate(verdicts: VerificationVerdict[], threshold: number): { hits: number; misses: number; total: number; ratio: number };

  // zipfian.ts (<= 60; mulberry32 inlined)
  export interface ZipfianOptions { nPages: number; nRequests: number; alpha?: number; seed?: number; }
  export function zipfian(opts: ZipfianOptions): number[];

  // runScenario.ts EDIT — branch BEFORE existing single-shot path.
  if (scenario.phases) {
    for (const phase of scenario.phases) {
      if (phase.preconditions?.clearProfileStore) await deps.clearProfileStore();
      if (phase.preconditions?.putProfile) await deps.seedProfile(phase.preconditions.putProfile);
      const verdicts = await replayBids(phase.bids, deps);
      assertVerdicts(verdicts, phase.expectations);
      if (phase.postWait === "waitForProfile") await waitForProfile(deps.profileStore, phase.bids[0].request.pageUrl);
    }
    return;
  }
  if (scenario.mode === "hit-rate-sweep") {
    const verdicts = await replayBids(scenario.bids!, deps);
    assertHitRate(verdicts, scenario.expectations[0].hitRateMin!);
    return;
  }
  // ... existing single-phase path (PRP-C) unchanged.
  ```

  ## Task order (TDD; commit-sized)

  **Task 1 — `ScenarioSchema` additive extensions.** *Red.* Extend PRP-A's
  `types.test.ts`: (happy) `phases?`+`mode?`+`reasonRefs?` round-trip;
  existing fixtures still parse. (edge) both `bids`+`phases` → `.refine`
  rejects. (edge) neither → rejects. *Green.* Edit `types.ts` additively
  (≤50 added lines). PRP-A/C/D tests stay green.

  **Task 2 — `waitForProfile`.** *Red.* (happy) profile at poll 3 → resolves;
  (edge) at poll 1 → 1 store call; (failure) never appears → rejects
  `WaitForProfileTimeoutError`. *Green.* Per contract; inject `clock` for
  fake-timer determinism.

  **Task 3 — `assertHitRate`.** *Red.* (happy) 80/100 @ 0.75 → returns ratios,
  no throw; (edge) 75/100 @ 0.75 → no throw (boundary inclusive); (failure)
  74/100 → throws with `0.74 < 0.75`; (property) `isCacheMiss` true iff any
  reason matches D4. *Green.* Per contract.

  **Task 4 — `zipfian`.** *Red.* (happy) `seed:42,nPages:20,nRequests:200` →
  top page ≥50, tail ≤5; (edge) `nRequests:0` → `[]`; (failure) `nPages:0` →
  throws; (determinism) same seed → byte-identical. *Green.* Mulberry32 +
  Zipf weights + cumulative inverse-transform.

  **Task 5 — `generate-sweep-pages.ts`.** One-shot. No env, no network, seed
  `42`. Writes 15 files `sweep-page-{06..20}.profile.json`. Does NOT overwrite
  hand-curated 01-05. ≤50 lines. Run once; commit output.

  **Task 6 — Profile fixtures.** Hand-author `fresh-tech-blog.profile.json`
  (per D10) + `sweep-page-{01..05}.profile.json` (warm; varied `categories`).
  Then `pnpm tsx packages/demo/scripts/generate-sweep-pages.ts` for 06-20.
  Extend PRP-A's fixture-schema test (do not duplicate) so every file
  round-trips through `PageProfileSchema.parse()`.

  **Task 7 — `runScenario` phase-handling.** *Red.* Extend PRP-C's
  `runScenario.test.ts`: (happy two-phase) phase A → `postWait` → phase B;
  (happy sweep) `assertHitRate` called with `expectations[0].hitRateMin`;
  (edge) defense-in-depth throws if both `bids`+`phases` slip past schema.
  *Green.* Implement per contract; existing single-shot path unchanged.

  **Task 8 — `scenario-05-phaseA.test.ts`.** *Red.* In-process gate via
  `createStores()`; wrap `profileQueue` with spy:
  `const enqueueSpy=vi.fn(); const wrapped={enqueue:async j=>{enqueueSpy(j); return stores.profileQueue.enqueue(j);}};`. Fire phase A bid. Await one
  event-loop tick: `await new Promise(r=>setImmediate(r))` (gate enqueue is
  `setImmediate`-deferred per `handler.ts:49`). Assert `decision==="DENY"`,
  `reasons[0].kind==="fail_closed"`, `reasons[0].ref==="cache_miss"`,
  `latencyMs<100`, `lobstertrapTraceId===null`. Assert spy called once with
  the four pinned fields. *Green.* No new impl — exercises existing handler.

  **Task 9 — `scenario-05-phaseB.test.ts`.** *Red.* After phase A,
  `await profileStore.put(freshTechBlog)`. Fire phase B bid (same
  `pageUrl`/`advertiserId`/`policyId`). Assert `decision==="ALLOW"`,
  `reasons` includes both `profile_signal` and `policy_rule`, `latencyMs<300`,
  `lobstertrapTraceId===null`. *Green.* No new impl.

  **Task 10 — `06-cache-hitrate-sweep.json` + `scenario-06.test.ts`.** *Red.*
  Generate 200-bid `bids[]` from `zipfian(...)`; inline. Test (marked
  `test.skip` in default; runs in `pnpm test:long`): seed top-5 only; replay
  200 bids; `assertHitRate(verdicts, 0.75)`; no throw. *Green.* No new impl.

  **Task 11 — Orchestrator integration.** Edit `scripts/run-demo.ts`: add
  `03,04,05` to scenario list (drives all 5 stage sequentially);
  `--scenario 06` routes ONLY scenario 06 (used by `pnpm demo:hitrate`);
  assert accelerated wall-clock for FULL 5-scenario sweep <60s; fail loud.

  **Task 12 — `run-all-ordering.test.ts`.** *Red.* Boot in-process gate +
  PRP-D's mock `LlmClient`. Run `runAllScenarios(["01","02","03","04","05"], {mode:"accelerated",llm:"mock"})`. Assert total wall-clock <60s (D12);
  each scenario verdict shape; `profileStore.get(scenario5.pageUrl)===null`
  immediately before scenario 5 (pins D13); phase A spy fires; phase B ALLOW.
  *Green.* No new impl.

  **Task 13 — npm scripts.** Edit `packages/demo/package.json`:

  ```json
  "scripts": {
    "test": "vitest run", "test:watch": "vitest",
    "test:long": "vitest run --testNamePattern \"hit-rate\"",
    "demo": "tsx scripts/run-demo.ts",
    "demo:accelerated": "tsx scripts/run-demo.ts --mode accelerated --llm=mock",
    "demo:hitrate": "tsx scripts/run-demo.ts --scenario 06 --llm=mock"
  }
  ```

  Root `package.json`: `"demo":"pnpm --filter @scout/demo run demo"`.

  **Task 14 — Validation sweep.** Run § Validation gates. Capture
  `pnpm demo:accelerated` (5 summaries + <60s) and `pnpm test:long` (hit-rate
  ≥0.75) outputs for PR description.

  **Task 15 — Cluster done-criteria.** Tick every box in § Cluster done-criteria
  below. File two follow-ups (live-DPI-catch, multi-tenant cross-talk).
  Append to `CLAUDE.md § Stack`:

  > **Demo bidstream seeding** (locked 2026-05-19) — Recording-format `1.0`
  > (refuses unknown). `--mode realtime|accelerated` (default `realtime`);
  > `--llm=real|mock` (default `mock` on stage per Wi-Fi guard).
  > `DEMO_GATE_URL` default `http://localhost:3000`. Inter-scenario clear
  > (option C — `clear-state.ts` between scenarios; intra-scenario state
  > preserved for two-phase replay).

  ## Validation gates (executable, FULL submission-grade sweep)

  ```bash
  pnpm install
  pnpm --filter @scout/demo test
  pnpm --filter @scout/demo test:long
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r exec prettier --write .
  pnpm -r test
  pnpm -r build
  pnpm audit
  # Manual — local gate running, no Gemini key:
  pnpm demo --mode accelerated --llm=mock   # full 1->5; <60s; all [OK]
  pnpm demo:hitrate --llm=mock              # >=0.75 or fail loud
  # One-time, NOT a merge gate (captured for submission video):
  pnpm demo --mode realtime --llm=real      # needs GEMINI_API_KEY + Lobster Trap
  ```

  All gates → exit `0`. `pnpm demo:accelerated` output captured in PR per TODO.

  ## Latency gate

  Consumes the gate's P99 ≤1000ms SLA (gate PRP owns). Adds phase A
  `latencyMs<100` (fail-fast on miss; feature 47) and phase B `latencyMs<300`
  (warm-then-hit recovery). **Replayer recording fidelity** (±50ms per feature
  11) asserted by microbenchmark: fire scenario 1 100× against in-process
  gate, assert `stddev(verdict.latencyMs)<50ms`. Added to
  `run-all-ordering.test.ts` as opt-in (runs in `test:long`).

  ## Security guardrails

  - **Fixture grep gate** — `grep -rE "API_KEY|secret|bearer" packages/demo/fixtures/` returns zero. Asserted in `scenario-05-phaseA.test.ts`.
  - **No network from helpers** — `waitForProfile` is local `ProfileStore` only; `assertHitRate` operates on received verdicts; `zipfian` is pure compute; `generate-sweep-pages.ts` hermetic (no env, no network, seed `42`).
  - **No real-looking domains in sweep** — 20 sweep URLs use `https://example.com/sweep/{NN}` only (feature 174).
  - **No raw page content in profile fixtures** — `fresh-tech-blog` carries only structured signals; no DOM text, no screenshot bytes (feature 183).
  - **Spy assertion scope** — asserts ONLY the four pinned fields; never synthetic fields the queue might add (defense against locking queue schema from demo side).
  - **No `process.env.*` in `packages/demo/src/**`** — only PRP-A's `config.ts` reads `DEMO_GATE_URL`. This PRP adds zero env reads.

  ## Gotchas

  - **`waitForProfile` MUST poll, not sleep** (feature 191). D2+D3.
  - **`assertHitRate` keys on WIRE, not gate logs** (feature 190). D4.
  - **Gate enqueue is `setImmediate`-deferred** (`handler.ts:49`, post-`reply.send()`). Phase-A spy needs `await new Promise(r=>setImmediate(r))` after reply before asserting `enqueueSpy.mock.calls.length===1`. Without it, races.
  - **`ttl:21600` is SECONDS, not ms** (feature 100; `handler.ts:21`).
  - **Scenario 6 takes ~30s wall clock.** Keep `pnpm test:long` separate. D8.
  - **Accelerated <60s asserts on FULL 5-scenario sweep**, NOT per. Sum scenario times. D12.
  - **`createStores()` `ProfileQueue.enqueue` is no-op.** Spy wraps for assertion only; don't drive warm path from this PRP's tests. Manually `profileStore.put` the warm profile (feature 109).
  - **`ProfileStore.put` keys by `profile.url` alone** (`store/src/index.ts:71`) — NOT tenant-scoped per PRP-B coordination § 1. Manual put in phase B uses bid's `url`; works v1. When `@scout/shared`'s tenant-scoped interface reconciles, seeder picks up new arg without test changes.

  ## Out of scope — file as follow-ups

  - **Live-DPI-catch scenario** (feature 205) — v1 covered by submission video; file `demo-live-dpi-catch.md`.
  - **Multi-tenant cross-talk** (feature 203) — fixture supports it; v1 single-tenant; file `demo-multi-tenant-isolation.md`.
  - **Real OpenRTB capture+replay** (feature 204) — productionization.
  - **Docker replayer** (feature 208); **scenario 6 as stage scenario** (feature 206) — v1 CI only; **WebSocket verdict streaming** (feature 209) — dashboard reads `AuditStore`.
  - **`assertHitRate` threshold tuning** (TODO § 5) — data churn in fixture `hitRateMin`, NEVER in source.

  ## Anti-Patterns

  - Don't poll gate logs for hit-rate — use wire (feature 190).
  - Don't `setTimeout` for `waitForProfile` — poll (feature 191).
  - Don't fire scenario 6 in `pnpm test` — `test.skip`; runs `test:long`.
  - Don't run scenarios in parallel — orchestrator sequential (feature 91).
  - Don't drive actual warm-path profiler — manually `profileStore.put` (feature 109: "decoupled from profiler PRP state").
  - Don't put hit-rate threshold in code — fixture data only. D5.
  - Don't hand-write 200 bids — generate with `zipfian`, commit output. D9.
  - Don't add new runtime deps. `zipfian.ts` hand-rolled (mulberry32 inlined).
  - Don't introduce `--llm` or `--mode` flags — PRP-D/C own; consume here.
  - Don't add fields to `BidVerificationRequestSchema` or `VerificationVerdictSchema` — gate-owned. Phase-A spy on `ProfileQueue.enqueue` is the safe assertion seam.

  ## Cluster done-criteria checklist (PRP-E is last; tick all)

  - [ ] PRP-A merged (skeleton, `ScenarioSchema`, format `1.0`).
  - [ ] PRP-B merged (replayer/seeder/asserts/in-process gate).
  - [ ] PRP-C merged (scenarios 01+02 + orchestrator + `clear-state.ts`).
  - [ ] PRP-D merged (scenarios 03+04 + `llmMock.ts` + `--llm` + `politics-borderline`).
  - [ ] PRP-E merged (scenarios 05+06 + 3 helpers + npm scripts).
  - [ ] `features/clusterD/demo-bidstream-seeding.md` ticked in `FEATURE-TODO.md:87-93`.
  - [ ] Cross-cutting *Cache hit-rate validation* ticked in `FEATURE-TODO.md:106-108`.
  - [ ] `pnpm demo --mode accelerated` run captured in PR (5 summaries + <60s).
  - [ ] `pnpm test:long` run captured showing scenario 6 hit-rate ≥0.75 (or tuned value with fixture updated per TODO § 5).
  - [ ] `CLAUDE.md § Stack` updated with cluster bullet (Task 15).
  - [ ] Follow-ups filed: `demo-live-dpi-catch.md`; `demo-multi-tenant-isolation.md`.
  - [ ] Submission video records ONE `--llm=real` run against real Gemini + Lobster Trap (TODO final; feature 163 recommend C). On-stage cut `--llm=mock`.

  ## Confidence: 7 / 10

  Capstone atop four green prereqs. Bounded but real risk:

  - **Two timing-sensitive interactions.** Phase A → phase B wait (poll-not-sleep per D2/D3) and accelerated wall-clock cap (D12). Both stage-flake generators if mis-shaped. Mitigated by fail-loud timeout and sum-across-scenarios assertion.
  - **`ScenarioSchema` extensions land additively.** PRP-A/C/D fixtures must still parse after Task 1; all new fields optional; `.refine` on `phases ⊕ bids` is the one new failure surface — Task 1 pins both branches.
  - **Cross-package coordination.** Profiler warm-path runtime NOT driven from this PRP's tests (feature 109); warm profile manually `profileStore.put`. Gate's `setImmediate` enqueue requires one event-loop tick await before spy assertion. Both documented in § Gotchas.
  - **Cluster done-criteria.** Task 15 depends on PRPs A-D actually merged; if PRP-E lands ahead, checklist blocks merge — by design.

  The `--llm=real` capture is NOT a merge gate; runs once before May 19 demo. Failing on demo day with `--llm=mock` + recorded video as backup is the recovery plan (feature 163 recommend C).
