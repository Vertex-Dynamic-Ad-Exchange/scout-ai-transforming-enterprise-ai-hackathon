# demo-bidstream-seeding — PRP progress tracker

> Five-PRP split of `features/clusterD/demo-bidstream-seeding.md` (223
> lines). Each PRP is commit-sized for a single Claude Code session,
> ordered by dependency. Tick the box when the PRP's full validation
> sweep is green AND the PR lands on `main`.
>
> Pattern mirrors `PRPs/clusterB/profiler-real-loop/TODO.md`.

Source feature × ~8× expansion projected. Each PRP capped at 400 lines.

## Order (each PRP blocks the next unless noted)

- [ ] **PRP-A — `demo-package-foundation.md`** (target 300–350 lines)
      → `PRPs/clusterD/demo-bidstream-seeding/demo-package-foundation.md`
      Lands the `@scout/demo` package skeleton, the recording-format
      zod schemas (`ScenarioSchema`, `RecordedBidSchema`,
      `ExpectationSchema`, `formatVersion: "1.0"` with refusal on
      unknown versions), the `DEMO_GATE_URL` config module, the
      `fixtures/README.md` format spec, and the initial barrel
      exporting the types. **No replayer body, no seeder body, no
      scenario fixtures, no scripts** — those land in PRPs B–E.
      *Blocks:* PRP-B, PRP-C, PRP-D, PRP-E.
      *Validation gate:* `pnpm --filter @scout/demo test` +
      `pnpm -r exec tsc --noEmit` green.

- [ ] **PRP-B — `demo-replayer-seeder-asserts.md`** (target 400 lines)
      → `PRPs/clusterD/demo-bidstream-seeding/demo-replayer-seeder-asserts.md`
      Lands the core engine: `replayer.ts` (HTTP body, undici keep-alive
      Agent, per-bid latency capture), `seeder.ts` (wraps
      `@scout/store`'s `ProfileStore.put`/`PolicyStore` for pre-seeding,
      reconciles the `@scout/shared` vs `@scout/store` `ProfileStore`
      interface drift), `asserts.ts` (verdict-shape assertions per
      `Expectation`), and an `inProcessGate.ts` test harness that boots
      Fastify with the *real* `createApp(deps)` handler (no mocks inside
      the gate). 1 happy + 1 edge + 1 failure per module.
      *Prereq:* PRP-A merged (consumes `ScenarioSchema`,
      `ExpectationSchema`).
      *Validation gate:* `pnpm --filter @scout/demo test` green.

- [ ] **PRP-C — `demo-scenarios-1-2-orchestrator.md`** (target 400 lines)
      → `PRPs/clusterD/demo-bidstream-seeding/demo-scenarios-1-2-orchestrator.md`
      Lands the first two stage scenarios + the orchestrator wrapper.
      Files: `fixtures/scenarios/01-clean-allow.json` +
      `02-clean-deny.json`, `fixtures/pages/news-site.profile.json` +
      `gambling-page.profile.json`, `src/runScenario.ts` +
      `runAllScenarios()` (added to barrel), `scripts/run-demo.ts`
      (orchestrator with `/health` check + fail-loud on unreachable
      gate), `scripts/clear-state.ts` (between-scenario reset; clears
      `ProfileStore` + `AuditStore`).
      Tests: scenario 1 ALLOW happy-path against in-process gate;
      scenario 2 DENY; determinism (replay 2× → deep-equal verdicts);
      clear-state assertion (`ProfileStore.get(url) === null` after).
      *Prereqs:* PRP-A + PRP-B merged.
      *Validation gate:* `pnpm --filter @scout/demo test` green;
      manual `pnpm demo --mode accelerated` smokes scenarios 1+2.

- [ ] **PRP-D — `demo-scenarios-3-4-llm-modes.md`** (target 400 lines)
      → `PRPs/clusterD/demo-bidstream-seeding/demo-scenarios-3-4-llm-modes.md`
      Lands scenario 3 (Gemini Flash on the hot path → Track 2 demo
      moment) and scenario 4 (HUMAN_REVIEW arbiter disagreement → Track
      1 demo moment) plus the LLM-mock infrastructure that lets the
      replayer run offline on stage. Files:
      `fixtures/scenarios/03-ambiguous-flash.json` +
      `04-human-review-disagreement.json`,
      `fixtures/pages/politics-borderline.profile.json` +
      `disputed-news.profile.json`, **`packages/policy/fixtures/politics-borderline.json`**
      (cross-package fixture — new policy authored here, coordinated
      with policy-match PRP per § Cross-PRP coordination 3),
      `src/llmMock.ts` (pinned Flash response + pinned
      `lobstertrapTraceId`), `--llm=real|mock` flag wired through
      `runScenario`. Tests: scenario 3 (Flash response + non-null
      trace ID round-trip into `VerificationVerdict.lobstertrapTraceId`);
      scenario 4 (pre-seeded `dom_snippet` evidence ref → gate emits
      `Reason{kind:"arbiter_disagreement"}`); mock-leak regression
      (`vi.resetModules()` in `afterEach`, scenario 1 still has
      `lobstertrapTraceId: null`).
      *Prereqs:* PRP-A + PRP-B + PRP-C merged.
      *Validation gate:* `pnpm --filter @scout/demo test` green.

- [ ] **PRP-E — `demo-scenarios-5-6-ci.md`** (target 400 lines)
      → `PRPs/clusterD/demo-bidstream-seeding/demo-scenarios-5-6-ci.md`
      Lands the cinematography-closing scenario 5 (cache-miss
      DENY → profile warms async → second bid hits) and the
      CI-only scenario 6 (200-req Zipfian hit-rate sweep), plus the
      submission-grade validation sweep. Files:
      `fixtures/scenarios/05-cache-miss-deny-then-warm.json` +
      `06-cache-hitrate-sweep.json`,
      `fixtures/pages/fresh-tech-blog.profile.json` (the phase-B warm
      profile manually `ProfileStore.put` by the test rig — decouples
      this PRP from profiler PRP runtime state),
      `src/waitForProfile.ts` (polling helper — NOT a fixed sleep,
      see § Cross-PRP coordination 4), `src/assertHitRate.ts`
      (counts `Reason{kind:"fail_closed",ref:"cache_miss"}` on the
      wire, NOT in gate logs), `src/zipfian.ts` (synthetic generator,
      ≤ 60 lines), npm scripts in `packages/demo/package.json`
      (`pnpm demo`, `pnpm demo:accelerated`, `pnpm demo:hitrate`,
      `pnpm test:long`), root-`package.json` `demo` alias.
      Tests: scenario 5 phase A (`ProfileStore` clean, `ProfileQueue.enqueue`
      spy fires exactly once, verdict is
      `fail_closed`/`cache_miss`, `latencyMs < 100`); scenario 5
      phase B (after `waitForProfile`, second bid hits cache,
      verdict carries `profile_signal`); scenario 6 (`assertHitRate`
      ≥ 0.75, `test.skip` in default `pnpm test`, runs in
      `pnpm test:long`); full `runAllScenarios()` 1→5 ordering test
      (accelerated mode, < 60s wall clock).
      *Prereqs:* PRP-A + PRP-B + PRP-C + PRP-D merged.
      *Validation gate:* full `pnpm -r exec tsc --noEmit && pnpm -r
      test && pnpm -r build && pnpm audit` green, plus one manual
      `pnpm demo --mode accelerated` full sweep on a machine with a
      locally-running gate (no Gemini key required — `--llm=mock` is
      stage default).

## Update protocol

When a PRP's validation gate is green AND the PR is merged:
1. Tick the box above.
2. Cross-check the coordination flags below; if any was resolved
   by that merge, strike through here.
3. After PRP-E ships, tick the `features/clusterD/demo-bidstream-seeding.md`
   row in `FEATURE-TODO.md:87-93` AND tick the cross-cutting
   *Cache hit-rate validation* row (`FEATURE-TODO.md:106-108` —
   folded into scenario 6 per § Other Considerations).

## Cross-PRP coordination — resolve before the named PRP lands

These came out of the five parallel drafts. Each is small but a silent
mismatch will cost a one-commit fix downstream.

### 1. `ProfileStore.put` signature drift *(blocks PRP-B)*

Two competing `ProfileStore` interfaces exist in the repo:

- `@scout/store`'s local one (`packages/store/src/index.ts`):
  `put(profile: PageProfile): Promise<void>` — keyed internally by
  `profile.url` alone.
- `@scout/shared`'s interface (`packages/shared/src/interfaces/profileStore.ts`):
  `put(advertiserId: string, profile: PageProfile): Promise<void>` —
  tenant-scoped per profiler PRP-E.

The demo's seeder calls `@scout/store`'s impl (the same one the gate
process uses at runtime, per the gate handler at
`packages/gate/src/handler.ts:48`). **Recommend: PRP-B uses the
`@scout/store` shape verbatim** and the feature file's "tenant-scoped
seeder" constraint becomes an assertion in PRP-B's tests (the seeder
threads `advertiserId` into the fixture's `bids[].request.advertiserId`
so cross-tenant leaks are observable at the wire). When the foundation
reconciles the two `ProfileStore` shapes, the seeder picks up the new
arg without test changes.

### 2. `LlmClient` mock placement *(blocks PRP-D)*

Feature file line 79 is explicit: *"`@scout/llm-client` is `vi.mock`'d
at the OpenAI layer (NOT at the Lobster Trap layer)"*. PRP-D must
mock at the `@scout/llm-client` module boundary — `vi.mock("@scout/llm-client",
...)` returning a `createLlmClient`-shaped factory whose `chat()`
returns the pinned Flash response. Mocking deeper (inside the OpenAI
SDK or inside the Lobster Trap proxy seam) is the *anti-pattern* the
constraint guards against — the gate's `Reason{ref:"lobstertrap_denied"}`
path must remain exercisable in tests, which means the gate's `LlmClient`
call must traverse the same module boundary at test time as at runtime.

### 3. `politics-borderline` policy fixture cross-package edit *(blocks PRP-D)*

PRP-D creates `packages/policy/fixtures/politics-borderline.json` — a
file in another package's directory. Mirrors `packages/policy/fixtures/{brand-safe-news,gambling-strict,permissive-baseline}.json`
shape (see `packages/policy/fixtures/brand-safe-news.json`). **Coordinate
filename with the `policy-match-evaluation.md` PRP's author** — if a
fixture with the same name already exists, append rules instead of
overwriting. PRP-D's first task should `grep -r "politics-borderline"
packages/policy/` and skip create if a hit comes back.

### 4. `waitForProfile` poll vs. sleep *(blocks PRP-E)*

Feature gotcha line 191 is explicit: the wait between scenario 5
phase A and phase B must poll `ProfileStore.get(url)` for a non-null
value, **not** sleep for a fixed duration. PRP-E's `waitForProfile.ts`
is the helper. Default `timeoutMs: 60000` with `pollIntervalMs: 500`;
demo fails loud (non-zero exit) on timeout. A fixed-sleep impl will
either delay the demo unnecessarily (overestimate) or miss the commit
(underestimate when profiler is slow under load) — both are stage-flake
generators.

### 5. `assertHitRate` threshold tuning *(handed off PRP-E → follow-up)*

Feature file line 196 calls 0.75 a *guess* — the architecture doc says
"modest cache gets the hit-rate up fast" without a number. PRP-E ships
0.75 as the initial value *in the scenario 6 fixture* (`expectations[].hitRateMin`),
not in code. After the first real CI run, the actual measurement
replaces the guess **in the fixture, not in any source file** — so
threshold changes are data churn, not code churn. Filed as a follow-up
in PRP-E's *Out of scope* section.

### 6. `creativeRef` field convention *(resolved — PRP-B owns)*

`BidVerificationRequestSchema` requires `creativeRef: z.string().min(1)`
(`packages/shared/src/schemas/bid.ts:7`). Fixtures encode it as a
ULID-shaped synthetic string (`creative-01HMXY...`). PRP-B's
`replayer.ts` passes the recorded value verbatim — never synthesizes —
so a fixture authored in week 1 stays byte-identical in week 2's wire.
**No action.**

## Per-PRP confidence (self-rated, target — implementing agent re-scores)

| PRP | Target lines | Initial confidence | Risk |
|---|---|---|---|
| A — foundation | 300–350 | 9/10 | Greenfield package; only risk is locking the recording format prematurely. `formatVersion: "1.0"` versioning shields against this. |
| B — engine | 400 | 7/10 | Two seams (HTTP + in-process gate) and the `ProfileStore` drift (§ 1). undici keep-alive is the one perf-sensitive piece. |
| C — scenarios 1+2 | 400 | 8/10 | Two end-to-end happy paths against the real gate handler. Determinism test catches the largest class of stage flake. |
| D — scenarios 3+4 | 400 | 7/10 | `vi.mock` discipline (§ 2) and the cross-package policy fixture (§ 3). Mock leak is the main regression risk. |
| E — scenarios 5+6 | 400 | 7/10 | Two-phase replay timing + the Zipfian distribution + the full validation sweep landing here. § 4's poll-vs-sleep is the biggest stage-flake guard. |

## Done criteria for the cluster

- [ ] All 5 PRPs ticked above.
- [ ] `features/clusterD/demo-bidstream-seeding.md` ticked in `FEATURE-TODO.md:87-93`.
- [ ] Cross-cutting *Cache hit-rate validation* row ticked in
      `FEATURE-TODO.md:106-108` (folded into scenario 6).
- [ ] One full `pnpm demo --mode accelerated` run captured in PR
      description (output of the 5 scenario summaries + the < 60s wall
      clock), per feature file lines 92, 222.
- [ ] One `pnpm test:long` run captured showing scenario 6 hit-rate
      ≥ 0.75 (or, if tuned, the actual measured value with the
      fixture updated to match — per § Cross-PRP coordination 5).
- [ ] `CLAUDE.md § Stack` updated with: recording-format version (`1.0`),
      `--mode realtime|accelerated` flag default, `--llm=real|mock`
      flag default (mock on stage), `DEMO_GATE_URL` default
      (`http://localhost:3000`), inter-scenario clear pattern (option
      C per feature line 157). (Cluster's locked decisions, per
      `CLAUDE.md § Update protocol`.)
- [ ] Two follow-up tickets filed: (a) live-DPI-catch scenario for the
      submission video (feature file *Out of scope* line 205), (b)
      multi-tenant cross-talk scenario (feature file *Out of scope*
      line 203 — `demo-multi-tenant-isolation.md`).
- [ ] Submission video records ONE full `--llm=real` run against real
      Gemini + real Lobster Trap (feature file line 163 recommendation
      C). The on-stage cut runs `--llm=mock` per Wi-Fi guard at
      `features/clusterD/demo-bidstream-seeding.md:195`.
