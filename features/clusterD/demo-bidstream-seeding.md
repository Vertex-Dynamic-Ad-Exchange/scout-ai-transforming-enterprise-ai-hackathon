You are a senior demo-engineering TypeScript engineer fluent in deterministic fixture authoring (recorded request streams with pinned timing), HTTP-driven replay harnesses that mock nothing inside the system-under-test (the replayer is *outside* the gate, not a test double inside it), tenant-scoped seed-data round-trips through real `ProfileStore` / `PolicyStore` / Lobster Trap proxies, hackathon stage choreography under unreliable Wi-Fi, and the discipline of treating the demo as a *fifth integration-test surface* — every scenario is a `pnpm` script that has to pass green in CI before it's allowed in front of judges.

## PRIORITY:

**P0 — no on-stage demo May 18–19 without this.** Corresponds to the `demo-bidstream-seeding.md` row in `FEATURE-TODO.md:83-88` under *Cluster D — Surface area & demo*, and folds in *Cross-cutting validation → Cache hit-rate validation* (`FEATURE-TODO.md:99-101`) since the synthetic mixed-popularity bidstream is the same fixture shape this PRP authors. Independent of every verifier-prompt row (`FEATURE-TODO.md:60-70`) — the replayer drives `POST /verify` on the gate, never agents directly — but **load-bearing on every other PRP that has landed**: this is the only PRP whose end state is "the judges see the product working."

Stakes: this is what the judges experience. If `gate-verdict-logic.md` is perfect, `profiler-real-loop.md` is perfect, `agent-arbiter-scoring.md` is perfect, and this PRP is half-baked, **the demo is half-baked**. Conversely, if this PRP is rock-solid and the upstream PRPs have rough edges, the demo can still tell a coherent story because the fixtures pin the path through the system. Everything else — every typed boundary, every Lobster Trap trace, every Gemini Flash latency win — is invisible if the on-stage cut doesn't land.

**Both prize narratives in one cut.** The five-scenario sequence is the submission video's only chance to show *both* Track 1 (Veea Lobster Trap DPI catches a prompt-injection on a verifier's LLM call → `Reason{kind:"fail_closed",ref:"lobstertrap_denied"}` surfaces in the verdict + dashboard) **and** Track 2 (Gemini Flash on the hot path, Gemini Pro on warm-path fan-out via the cache-miss → DENY-then-warm scenario). The replayer's scenario order is therefore not just a demo concern — it's the *cinematography* of the submission video (`HACKATHON-CONTEXT.md:51-57`, `FEATURE-TODO.md:110-118`).

**Latency stakes — NOT a hot-path consumer.** The replayer is *external* to the gate; the gate's P99 SLA (`features/clusterA/gate-verdict-logic.md:29-35`) is consumed but not extended. The replayer's only timing requirement is its own *recording fidelity* — replay timings must be reproducible to within ±50ms so on-stage flake isn't introduced by the replayer itself.

## FEATURE:

A new `@scout/demo` package (`packages/demo/`, currently absent) + a hand-authored fixture corpus under `packages/demo/fixtures/` that together drive `POST /verify` on a running gate (`features/clusterA/gate-verdict-logic.md:7-19`) through **exactly five named scenarios** in fixed order — plus a sixth optional cache-validation sweep. Each scenario is a self-contained `BidVerificationRequest[]` recording with pinned expected `VerificationVerdict` shapes, asserted on replay. The replayer is the *only* component that touches the system from outside; it does not stub, patch, or import the gate's internals.

**The five scenarios (in stage order):**

1. **`01-clean-allow.json`** — *fast cache-hit ALLOW.*
   - Pre-seeded `PageProfile` in `ProfileStore` keyed `(advertiserId, contentHash)` with `categories: [{label: "News", confidence: 0.94}]`.
   - Pre-seeded `Policy` (`brand-safe-news` fixture, `features/clusterA/policy-match-evaluation.md:38`) with a `kind: "category"` rule on `News` → `ALLOW`.
   - One `BidVerificationRequest` → expects `{decision: "ALLOW", reasons: [{kind:"profile_signal", ref:"News"}, {kind:"policy_rule", ref:"<ruleId>"}], lobstertrapTraceId: null}` and `latencyMs < 300`.
   - **Demonstrates**: hot path under SLA, zero LLM call, clean cache hit. Sets the baseline pace.

2. **`02-clean-deny.json`** — *fast cache-hit DENY (opposite outcome).*
   - Pre-seeded `PageProfile` with `categories: [{label: "Gambling", confidence: 0.91}]`.
   - Policy `gambling-strict` (`features/clusterA/policy-match-evaluation.md:38`) DENYs the `Gambling` category.
   - Expects `{decision: "DENY", reasons: [..."policy_rule"...], lobstertrapTraceId: null, latencyMs < 300}`.
   - **Demonstrates**: same fast path, opposite verdict. *No LLM round-trip* on either ALLOW or DENY when the policy is clear-cut — this is the headline performance claim.

3. **`03-ambiguous-flash.json`** — *gate calls Gemini Flash inside the 400ms budget.*
   - Pre-seeded `PageProfile` with `categories: [{label: "Politics", confidence: 0.42}]` — straddles the advertiser's `humanReviewThreshold` (0.5 in fixture).
   - Policy with `escalation.ambiguousAction: "DENY"` and a Politics rule action threading through the ambiguous path (`features/clusterA/gate-verdict-logic.md:80-83`).
   - Expects `{decision: "ALLOW"|"DENY", lobstertrapTraceId: <non-null string>, latencyMs ∈ [200, 900]}` — Flash result is non-deterministic in shape but bounded in timing.
   - **Demonstrates** (Track 2 — Gemini): Flash on the hot path, one call, sub-second total, `lobstertrapTraceId` round-trips through Lobster Trap into the verdict (`features/clusterA/gate-verdict-logic.md:25`). This is the Gemini Award's first visible moment.

4. **`04-human-review-disagreement.json`** — *`HUMAN_REVIEW` arbiter disagreement surfaces.*
   - Pre-seeded `PageProfile` whose `evidenceRefs[]` includes a `kind: "dom_snippet"` entry produced by a prior `agent-arbiter-scoring.md` HUMAN_REVIEW run (a hand-crafted snapshot of an actual disagreement output: text-verifier ALLOW@0.6, image-verifier DENY@0.85, video-verifier ALLOW@0.5; arbiter resolves `HUMAN_REVIEW` per `features/clusterC/agent-arbiter-scoring.md:48`).
   - Profile's `categories[]` left intentionally sparse so policy match defaults to `Reason{kind:"arbiter_disagreement"}` per `features/clusterA/gate-verdict-logic.md:43`.
   - Expects `{decision: "HUMAN_REVIEW", reasons: [{kind:"arbiter_disagreement", ...}], lobstertrapTraceId: <chain of four trace IDs surfaced in dashboard>}`.
   - **Demonstrates** (Track 1 — Veea): "this isn't three rubber-stamps." The dashboard's `dashboard-verdict-views.md` disagreement panel surfaces the per-verifier confidences and the four-trace-ID chain (text, image, video, arbiter per `features/clusterB/profiler-real-loop.md:264`). This is the *independent verification* claim made visible.

5. **`05-cache-miss-deny-then-warm.json`** — *cache-miss → DENY now, profile warms async, replay shows ALLOW on second bid.*
   - `ProfileStore` is **clean** for this page (the demo runner clears the `(advertiserId, contentHash)` key before scenario 5 runs).
   - **Two-phase replay**:
     - **Phase A** — fire one `BidVerificationRequest`. Expect `{decision: "DENY", reasons: [{kind:"fail_closed", ref:"cache_miss"}], lobstertrapTraceId: null, latencyMs < 100}`. Profiler picks up the enqueued `ProfileJob` (`features/clusterA/gate-verdict-logic.md:26`, `features/clusterB/profiler-real-loop.md:71`); the four verifier LLM calls fire through Lobster Trap (this is *where* the Veea seam is exercised live — `features/clusterB/profiler-real-loop.md:190`).
     - **Phase B** — after `await waitForProfile(url, {timeoutMs: 60000})` (polls `ProfileStore` directly), fire a second `BidVerificationRequest` with same `pageUrl`/`advertiserId`/`policyId`. Expect `{decision: "ALLOW"|"DENY", reasons: [..., "profile_signal", ...], lobstertrapTraceId: null}` and `latencyMs < 300` — cache-hit on the freshly-committed profile.
   - **Demonstrates** (both tracks): the architecture's narrative arc (`features/architecture.md:32-37`, `features/architecture.md:41-55`) — hot path fails fast on miss, warm path resolves it, next bid is sub-second. **Both Gemini Pro** (warm-path verifiers) **and Lobster Trap DPI** (each verifier→LLM call routes through it) are exercised in the same scenario.

**Optional 6th scenario — `06-cache-hitrate-sweep.json`** (folds *Cross-cutting validation* `FEATURE-TODO.md:99-101` into this PRP):

- A synthetic mixed-popularity bidstream: 200 `BidVerificationRequest`s across 20 unique pages, Zipfian distribution (top page gets ~60 bids, long tail gets 1–2 each). Pre-seeded `ProfileStore` warm for top-5 pages only — the rest miss the first time, hit the second.
- Runs *only* against the `assert-hit-rate` mode of the replayer. Asserts: post-sweep `(hit-count / total-requests) ≥ 0.75` (the architecture doc's *"a modest cache gets the hit-rate up fast"* assumption, `features/architecture.md:37`).
- Not in the stage cut — it's a CI gate run before stage day. If it fails, the architecture's modest-cache assumption is wrong and the demo's pacing has to change.

**File paths (proposed; foundation hasn't created any of them):**

- `packages/demo/package.json` — new package, depends on `@scout/shared` + `@scout/store` (workspace) + `undici` (HTTP client; native fetch is fine too — see *Open questions*). **NO** dep on `@scout/gate` / `@scout/profiler` / agents — the replayer is HTTP-only across the gate's wire boundary.
- `packages/demo/src/index.ts` — barrel; exports `runScenario`, `runAllScenarios`, `assertHitRate`.
- `packages/demo/src/replayer.ts` — the HTTP replayer body (≤ 200 lines).
- `packages/demo/src/seeder.ts` — pre-seed `ProfileStore` + `PolicyStore` per scenario (≤ 150 lines).
- `packages/demo/src/asserts.ts` — verdict-shape assertions per scenario (≤ 100 lines).
- `packages/demo/fixtures/scenarios/01-clean-allow.json` … `06-cache-hitrate-sweep.json` — recording format (see *DOCUMENTATION* and *OTHER CONSIDERATIONS*).
- `packages/demo/fixtures/pages/{news-site, gambling-page, politics-borderline, disputed-news, fresh-tech-blog}.profile.json` — pre-seeded `PageProfile` rows. Each round-trips through `PageProfileSchema.parse` (`packages/shared/src/schemas/profile.ts:22`).
- `packages/demo/fixtures/policies/` — symlink-or-reference into `packages/policy/fixtures/` (`features/clusterA/policy-match-evaluation.md:38`); the demo does NOT duplicate the policy fixtures, only references them by ID.
- `packages/demo/scripts/run-demo.ts` — orchestration script: starts gate (`pnpm dev:gate` per `PRPs/foundation-ad-verification.md:291`), waits for `/health`, runs the five scenarios in order, prints a one-line summary per scenario, exits 0 / non-zero.
- `packages/demo/scripts/clear-state.ts` — `ProfileStore.clear()` + `AuditStore.clear()` between scenarios (the demo runner calls this; see *Cache state per scenario*).

**Module seam (load-bearing):**

The replayer drives the gate via `POST http://localhost:3000/verify` with `BidVerificationRequestSchema`-valid bodies; reads `VerificationVerdictSchema`-valid responses; asserts against pinned expected shapes. **It does not import `@scout/gate`'s handler.** It does import `@scout/store`'s in-memory `ProfileStore` + `PolicyStore` impls (foundation task 4, `PRPs/foundation-ad-verification.md:243-245`) for *seeding* — that's a separate seam from request-time gate behavior. **It does not touch agent packages, ever** — `FEATURE-TODO.md:86-88` is explicit: "drives the gate, not the agents directly."

**Tests — each scenario deterministic and repeatable:**

- **Per-scenario unit tests** (`packages/demo/src/__tests__/scenarios.test.ts`):
  - **Schema** — every fixture round-trips through `BidVerificationRequestSchema.parse` (bids) + `PageProfileSchema.parse` (seeds). A malformed fixture fails CI, not the demo.
  - **Scenario 1 (ALLOW)** — replay-against-an-in-process-gate (a `Fastify` instance booted in the test with the same handler the prod gate uses, no mocks) returns ALLOW with `latencyMs < 300`.
  - **Scenario 2 (DENY)** — same shape, DENY.
  - **Scenario 3 (Flash)** — `@scout/llm-client` is `vi.mock`'d at the OpenAI layer (NOT at the Lobster Trap layer) to return a deterministic Flash response with a pinned `lobstertrapTraceId`. Asserts the verdict carries the trace ID; asserts `latencyMs < 900`.
  - **Scenario 4 (HUMAN_REVIEW)** — pre-seed profile carries the disagreement marker; assert `decision: "HUMAN_REVIEW"`, assert `reasons[0].kind === "arbiter_disagreement"`.
  - **Scenario 5 Phase A (cache miss DENY)** — in-process gate + in-memory `ProfileQueue`; assert phase-A response is `DENY` with `fail_closed`/`cache_miss`. Assert exactly one `ProfileQueue.enqueue` was called.
  - **Scenario 5 Phase B (warm-then-hit)** — manually `ProfileStore.put` the warm profile (simulating profiler commit); fire second request; assert cache-hit verdict.
  - **Scenario 6 (hit-rate)** — runs against a 200-request stream; asserts `hits / total ≥ 0.75`. Marked `test.skip` in default `pnpm test` (long-running); runs in a dedicated CI step.

- **Determinism test** — replay each scenario *twice in a row* against a fresh gate; assert identical verdict `decision`, identical `reasons[].kind` order, identical `profileId`. Latency may vary but stays under each scenario's bound. **Repeatable — no stage flakiness** (the constraint from `FEATURE-TODO.md` is hard).

- **Ordering test** — `runAllScenarios()` runs 1→5 in order; if scenario 3 leaves stale state in `ProfileStore`, scenario 5 (which expects a clean cache for its target URL) must still pass because `clear-state.ts` runs between every scenario. Test pins the property.

**Performance — real-time + accelerated modes:**

- **Real-time mode** (`pnpm demo --mode realtime`) — paces the 5-scenario sequence to the recorded timings + a fixed inter-scenario pause (default 3s, configurable). This is the *stage* mode; the audience sees natural pacing.
- **Accelerated mode** (`pnpm demo --mode accelerated`) — fires every scenario back-to-back, asserting verdict shapes only (no timing assertions). Used by CI and by pre-flight smoke (the *night-before-stage* check). Completes in <60s on a warm gate.
- **Both modes assert the same verdict shapes.** Timing assertions are mode-gated; correctness assertions are not.

## EXAMPLES:

- `packages/shared/src/schemas/bid.ts:3` — `BidVerificationRequestSchema`. Every fixture bid round-trips through `parse()` at fixture-load time. `geo` is alpha-2 (`packages/shared/src/schemas/bid.ts:8`); `ts` is ISO-8601 (`packages/shared/src/schemas/bid.ts:9`) — the replayer can either replay the recorded `ts` verbatim or stamp `new Date().toISOString()` per request (see *Open questions*).
- `packages/shared/src/schemas/verdict.ts:11` — `VerificationVerdictSchema`. Every expected verdict in a fixture round-trips through `parse()` at scenario-load time. A typo in `kind` ("fail_close" vs. "fail_closed") fails CI, not the demo.
- `packages/shared/src/schemas/verdict.ts:4` — `ReasonSchema`. The `kind` enum is the matrix the five scenarios cover: scenarios 1+2 emit `profile_signal` + `policy_rule`; scenario 3 emits `profile_signal` + `policy_rule` (Flash result is a profile signal); scenario 4 emits `arbiter_disagreement`; scenario 5 phase-A emits `fail_closed` (ref: `cache_miss`). Together they exercise every `Reason.kind`.
- `packages/shared/src/schemas/profile.ts:22` — `PageProfileSchema`. The seed-page format. Note `ttl` is **seconds** (`features/clusterA/gate-verdict-logic.md:55`); fixtures encode it as `21600` (6h), not `21600000`. A unit bug here means scenario 5 phase B sees a stale cache.
- `packages/shared/src/schemas/policy.ts:18` — `PolicySchema`. The replayer references policy fixtures by ID (`policy-id`); they live in `packages/policy/fixtures/` per `features/clusterA/policy-match-evaluation.md:38`.
- `packages/shared/src/schemas/primitives.ts:3` — `DecisionSchema { ALLOW | DENY | HUMAN_REVIEW }`. The triple-value decision space the five scenarios cover (each scenario pins one).
- `packages/gate/src/index.ts:1` — current `export {};`. After `features/clusterA/gate-verdict-logic.md` lands, this is the Fastify app exposing `POST /verify`. The replayer talks to this endpoint over HTTP; that's the entire seam.
- `packages/store/src/index.ts:1` — current `export {};`. After foundation task 4 lands (`PRPs/foundation-ad-verification.md:243-245`), this exports in-memory `ProfileStore` + `PolicyStore` + `AuditStore`. The demo's seeder imports the in-memory impl directly to pre-seed (faster + more reliable than warm-up traffic).
- `features/clusterA/gate-verdict-logic.md:24-26` — gate's cache-miss enqueue path. Scenario 5 phase A is the only scenario that exercises this; the assertion (`exactly one ProfileQueue.enqueue call with {url, advertiserId, policyId}`) mirrors the gate PRP's own test.
- `features/clusterA/gate-verdict-logic.md:36-47` — gate's exhaustive verdict matrix. Scenarios 1–5 are a *strict subset* of that matrix — the demo covers the customer-visible paths, the gate PRP covers the full failure-mode matrix.
- `features/clusterA/policy-match-evaluation.md:38` — `packages/policy/fixtures/{brand-safe-news,gambling-strict,permissive-baseline}.json`. The demo references these by ID (not by file copy). Scenarios 1–2 use `brand-safe-news` + `gambling-strict`; scenario 3 uses a new `politics-borderline` policy this PRP authors; scenario 4 uses `permissive-baseline`; scenario 5 uses `brand-safe-news`.
- `features/clusterB/profiler-real-loop.md:43-66` — `ProfileJobSchema`. Scenario 5 phase A enqueues this; the demo runner can either wait for the real profiler (if running) or `ProfileStore.put` a hand-crafted profile (faster, decoupled from profiler PRP state).
- `features/clusterB/profiler-real-loop.md:79-81` — partial-verifier-failure synthetic HUMAN_REVIEW. Scenario 4's pre-seeded profile is shaped *as if* this synthesis had run — letting the demo work even if profiler PRP hasn't landed yet.
- `features/clusterC/agent-arbiter-scoring.md:32-43` — `ArbiterDecisionSchema`. The disagreement marker in scenario 4's profile follows this shape so the dashboard's drill-down can render against real data shapes.
- `features/clusterC/agent-arbiter-scoring.md:5` — *"the replayer drives gate, gate reads a profile that was arbited to `HUMAN_REVIEW`, dashboard surfaces the disagreement panel."* This PRP is the *replayer* half of that sentence; arbiter PRP is the *profile-shape* half.
- `features/architecture.md:32-37` — cache-miss DENY-then-warm narrative arc. Scenario 5 *is* this paragraph made executable.
- `features/architecture.md:75-77` — *"every agent → LLM call routes through Lobster Trap."* Scenario 5's phase A is where this is exercised live in the demo (the warm-path profiler dispatches four LLM calls per the cache-miss recovery; each carries a `_lobstertrap` declared intent and surfaces a `lobstertrapTraceId`).
- `features/architecture.md:153-159` — *"Real RTB integration. Demo uses a mocked bidstream replaying recorded bids. Live publisher onboarding flow. Pages are pre-seeded."* This PRP is the executable form of these two lines.
- `PRPs/foundation-ad-verification.md:124` — foundation lists `@scout/scripts` (`seedPolicies`, `pingLobstertrap`); this PRP adds `@scout/demo` as a sibling package. **Coordinate filename / package-scope conventions** with the existing `scripts/` package — same `package.json` shape, same workspace entry.
- `PRPs/foundation-ad-verification.md:318` — *"Demo seeding (recorded bidstream replayer, pre-seeded pages)"* — foundation explicitly defers this PRP. This is the file that fills the hole.
- **Greenfield otherwise** — no in-repo replayer / fixture-corpus precedent. The recording format itself is invented here; see *DOCUMENTATION*.

## DOCUMENTATION:

- **OpenRTB 2.5 bid request spec** — the wire format real bidstreams use; the demo's `BidVerificationRequest` is a *deliberately simplified* subset (we only need `pageUrl`, `advertiserId`, `policyId`, `creativeRef`, `geo`, `ts`). Reference for the submission video's "this is what a real bidstream looks like" framing: <https://github.com/InteractiveAdvertisingBureau/openrtb2.x/blob/main/2.5.md#3211--object-bidrequest->
- **HAR 1.2 spec** — a *candidate* recording format. Verbose, browser-tooling-friendly, well-supported by replay libraries. Probably overkill for a 5-scenario corpus but worth referencing in the *Open questions* trade-off: <http://www.softwareishard.com/blog/har-12-spec/>
- **Custom JSON recording format (recommended; see *Open questions*)** — the chosen format is documented inline in `packages/demo/fixtures/README.md` (one page, ~30 lines). Shape:
  ```json
  {
    "name": "01-clean-allow",
    "description": "Fast cache-hit ALLOW for a brand-safe news page.",
    "seeds": {
      "profiles": ["news-site"],
      "policies": ["brand-safe-news"]
    },
    "bids": [
      { "delayMs": 0, "request": { "advertiserId": "...", "pageUrl": "...", ... } }
    ],
    "expectations": [
      { "decision": "ALLOW", "reasonKinds": ["profile_signal", "policy_rule"], "latencyMsMax": 300, "lobstertrapTraceIdNullable": true }
    ]
  }
  ```
- **Lobster Trap audit-log section** — the DPI showcase visible in scenarios 3, 4, and 5: <https://github.com/veeainc/lobstertrap#audit-log>. The dashboard's iframe (`features/architecture.md:128-131`) renders this audit log live; the demo's job is to *populate* it by driving traffic through the gate→llm-client→Lobster Trap chain.
- **Lobster Trap policy action vocabulary** — the verdict vocabulary the gate's `Reason.ref` strings align to: <https://github.com/veeainc/lobstertrap#configuration>
- **Prebid.js bid-request fields** — reference for hackathon judges who know the ad-tech space and expect real terminology: <https://docs.prebid.org/dev-docs/bidder-adaptor.html#bidrequest-parameters>
- **undici fetch + keep-alive** — the replayer reuses a single `undici.Agent` across all bids so connection setup doesn't blow scenario timing: <https://undici.nodejs.org/#/docs/api/Agent>
- **vitest `test.each`** — for the scenario-shape matrix test: <https://vitest.dev/api/#test-each>
- **Pin Gemini model IDs**: **N/A.** The replayer makes no LLM call; it drives traffic through the gate, which makes the Flash call (scenario 3). The pin lives in `@scout/llm-client/src/models.ts` (`PRPs/foundation-ad-verification.md:216-217`).

## OTHER CONSIDERATIONS:

- **Sponsor-tech relevance: BOTH (this is the cinematography).**
  - **Gemini** — scenarios 3 (Flash hot-path) and 5 phase A (Pro warm-path × 4 verifier calls). The submission video's *"Pro for verifiers, Flash for the gate"* claim is *shown* by stitching scenarios 3 and 5 into the cut.
  - **Lobster Trap** — scenarios 3 (single Flash call through Lobster Trap, `lobstertrapTraceId` in verdict), 4 (chain-of-trace-IDs surfaced in dashboard from a prior arbiter run), 5 phase A (four verifier calls through Lobster Trap — the *every-agent-LLM-call-through-Lobster-Trap* claim made executable). **Recommended visible Lobster Trap moment**: scenario 5 phase A. Reason: it's the only scenario where the *number* of trace IDs is impressive (four, fanned out), the dashboard's audit-log iframe shows live activity during the wait, and the narrative ("we DENY now, but the system is *working* in the background") gives the Veea narrative emotional weight.

- **Cache state per scenario.** (**Most consequential operational decision after determinism.**) Three options:
  - **(A) Each scenario clean-cache + seeds itself.** Strictest isolation; every scenario is a fresh world; trivially repeatable; *but* doesn't demonstrate the architecture's actual property (the same cache serves many bids). Scenario 5 phase B *needs* state to persist within the scenario.
  - **(B) Fixed sequence so the cache builds across scenarios.** Reflects production. Couples scenarios to order — a swap at demo time breaks correctness; debugging is hard.
  - **(C) Explicit warm/clear between scenarios.** `clear-state.ts` runs between scenarios 1→2, 2→3, 3→4, 4→5; *within* a scenario (e.g., scenario 5 phase A → phase B), state persists.
  - **Recommend (C).** Each scenario is a self-contained transaction; intra-scenario state matters; inter-scenario state does not. The demo runner orchestrates the clear; tests pin that the clear actually happened (an assertion that `ProfileStore.get(url) === undefined` immediately after `clearState()`).

- **Determinism on stage.** (**The most consequential decision overall.**) Three paths:
  - **(A) Mock Gemini at the OpenAI-SDK layer** (deterministic but fake). Scenario 3's Flash call returns a pinned response; `lobstertrapTraceId` is a pinned string. **Pros**: no flake, no quota concerns, demo runs offline. **Cons**: judges can ask "is that a real Gemini call?" — the answer is *no on the stage cut, yes in the submission video*.
  - **(B) Real Gemini, carefully-chosen pages** (authentic but flaky). Scenario 3 hits real Flash; scenario 5 phase A drives real Pro × 4 verifiers; demo's correctness depends on network + Gemini availability + Veea proxy uptime. **Pros**: maximum credibility. **Cons**: 8,000 attendees on convention-center Wi-Fi; any one of {network, Gemini, Lobster Trap} flakes → demo dies.
  - **(C) Hybrid: real Gemini in the *submission video* (pre-recorded), mock in the on-stage live cut.** Best of both — the recorded video has the receipts, the live demo can't flake. The replayer supports both modes via a `--llm=real|mock` flag wired into `@scout/llm-client`'s test rig.
  - **Recommend (C).** Stage flakes kill the demo regardless of which mode would have been "right"; the submission video is the durable artifact and *must* show real Gemini + real Lobster Trap. Credibility risk of mocked-on-stage is mitigated by the video and by the dashboard's Lobster Trap iframe (which can be a *recorded* iframe in stage mode, but the recording is from a real run). **Lock this before any fixture authoring**; everything downstream depends on it.

- **Fold cache hit-rate validation in?** (`FEATURE-TODO.md:99-101`.) Two paths:
  - **(A) Fold in — scenario 6 in this PRP.** Same recording format, same replayer, same `assertHitRate` helper. Cheaper; the synthetic mixed-popularity bidstream is already a *fixture corpus problem*.
  - **(B) Separate `cache-hitrate-validation.md` PRP.** Cleaner concern-separation; but the cache-hit-rate validation is *not* a stage scenario, so it's natural to live alongside the demo runner's CI sweep.
  - **Recommend (A).** Folded in as scenario 6, not part of the stage cut. Same replayer; one extra fixture file; one extra CI gate. Two files instead of two PRPs.

- **Recorded vs. live bidstream.** Three options:
  - **(A) Hand-authored fixtures** (the recommendation above). Hackathon-scoped; deterministic; no real-RTB plumbing needed; *but* the bid shape is the team's invention, not a captured production stream.
  - **(B) Captured + replayed from a real OpenRTB exchange.** Highest credibility; *but* PII concerns (`page_url`s carry tracking params; advertiser IDs are real) plus we don't have a feed.
  - **(C) Synthesised from an OpenRTB-shaped generator.** Middle ground; statistically realistic but not actually-real.
  - **Recommend (A).** Five hand-authored fixtures + one synthetic Zipfian sweep (scenario 6 is the (C)-flavored fallback for the cache-hit-rate claim). Production-grade RTB capture is the productionization story for the main product, filed as a follow-up. **Important**: the fixtures use a publicly-realistic-looking shape (alpha-2 geo, ISO-8601 ts, ULID-like advertiser IDs, `https://`-prefixed pageUrls pointing at well-known *example domains* like `example.com/news/...`) so the demo doesn't read as toy.

- **Both prize narratives in one cut — explicit scenario mapping:**
  - **Track 2 (Gemini Award):** scenario 3 (Flash hot-path) + scenario 5 phase A (Pro × 4 warm-path) — both are visible in the dashboard's verdict timeline and Lobster Trap iframe.
  - **Track 1 (Veea Award):** scenario 4 (HUMAN_REVIEW with chain-of-four-trace-IDs surfaced) + scenario 5 phase A (live Lobster Trap traffic on stage). The Veea-specific *DPI catch* moment — a verifier prompt-injection that Lobster Trap blocks — is *not* its own scenario in v1 (would require an adversarial page fixture that's hard to make plausible in 30 seconds of stage time); it's covered by *scenario 5 phase A's audit log naturally showing `_lobstertrap.verdict: "ALLOW"` for normal calls and a separately-recorded "look what happens if we inject" clip in the submission video*. File the *live-DPI-catch* scenario as a follow-up if time permits.

- **Security guardrails:**
  - **No secrets in fixtures.** No `GEMINI_API_KEY`, no `BROWSER_USE_API_KEY`, no signed bid payloads. Bid payloads are the wire shape (`BidVerificationRequest`), which has no auth field. Asserted by a test: `grep -r "API_KEY\|secret\|bearer" packages/demo/fixtures/` returns nothing. **Asserted in CI.** This is one of the constraint-check refusal triggers below.
  - **Tenant-scoped fixture format.** Every fixture carries an `advertiserId`. The replayer's `runScenario` validates that all bids in a scenario carry the same `advertiserId` (single-tenant per scenario) but the format *supports* a future multi-tenant fixture (e.g., two `advertiserId`s in the same recording, asserting cross-tenant isolation at the gate). The format is **not** locked-single-tenant. **This is the second constraint-check refusal trigger.**
  - **No raw page content in fixtures.** Seed `PageProfile`s carry `categories[]` + `detectedEntities[]` + `evidenceRefs[]` (URIs only) — never the original DOM text or screenshot bytes. The harness (`features/clusterB/harness-capture-page.md`) is the only thing that handles raw page content; the demo's profile fixtures are structured-only.
  - **`ProfileStore.put` keys with `(advertiserId, contentHash)`** — same scoping the profiler uses (`features/clusterB/profiler-real-loop.md:211`). A demo seeder that puts under `contentHash` alone is a cross-tenant leak; tests pin the key shape.
  - **No `process.env.*` in fixtures.** Fixtures are pure data; if a value needs to be parameterized (e.g., the gate URL), it goes in `packages/demo/src/config.ts` reading `DEMO_GATE_URL ?? "http://localhost:3000"`. **No** other env reads in `packages/demo/**`.

- **Gotchas:**
  - **Clock skew in `ts`.** A fixture recorded `2026-05-14T10:00:00Z` and replayed `2026-05-19T14:30:00Z` is *5 days stale*. The gate doesn't reject on `ts` age (it's an audit field), but the dashboard's verdict timeline does. **Replayer stamps `ts: new Date().toISOString()` per request by default**; a `--preserve-recorded-ts` flag exists for the rare case (e.g., replaying a captured production stream where original timestamps matter for ordering). Default is stamp-fresh.
  - **Localhost gate not running.** `run-demo.ts` health-checks `GET /health` before firing scenarios; if absent, prints a one-line error and exits non-zero. **Never silently fail-soft**: a "demo passed" message against an unreachable gate is the worst possible outcome.
  - **`assertHitRate` window.** Cache hit/miss in scenario 6 is determined by inspecting `VerificationVerdict.reasons[].ref` for `cache_miss` (miss) or absence of `cache_miss` (hit). Not via inspecting the gate's logs. The metric is *what the wire shows*, not *what the implementation knows*.
  - **Scenario 5 phase B race condition.** The wait between phases must poll `ProfileStore.get(url)` for a non-`undefined` value, *not* sleep for a fixed duration. The profiler PRP's commit can take 10s or 60s depending on Gemini Pro response time; a fixed sleep either delays the demo or misses the commit. Default `timeoutMs: 60000` with 500ms poll interval; demo fails loud if exceeded.
  - **`vi.mock` scope in scenario tests.** Each scenario test mocks `@scout/llm-client` independently; a leaked mock from scenario 3 into scenario 1 silently turns scenario 1 into "Flash was called for an ALLOW that shouldn't have called Flash." Each test file `vi.resetModules()` in `afterEach`. Pin the property with an assertion that scenario 1's verdict has `lobstertrapTraceId: null`.
  - **HAR vs. custom JSON drift.** If we pick HAR, the recording format is fixed; if we pick custom JSON, it's evolved. **Once locked, the format is frozen**: a fixture authored in week 1 must replay in week 2 against an evolved replayer. Versioning: a top-level `formatVersion: "1.0"` field; the replayer refuses to load `formatVersion` it doesn't understand. Filed in *Open questions*.
  - **Replayer's HTTP keep-alive across the suite.** A connection re-establishment between every bid eats ~5–15ms of "false latency" that the gate isn't actually responsible for. Use `undici.Agent({ keepAliveTimeout: 60000, keepAliveMaxTimeout: 60000 })` (or native `keepAlive: true`); pin in tests by asserting `verdict.latencyMs` doesn't include the connection cost (compare against a baseline).
  - **Convention-center Wi-Fi.** Stage demo MUST run without network. Recommend: **the on-stage cut runs entirely localhost** (gate + Lobster Trap proxy + Gemini-mock at the OpenAI-SDK layer). The submission video, recorded ahead of time, runs against real Gemini. Both modes share the same fixtures.
  - **`assertHitRate` ≥ 0.75 may be too aggressive.** The architecture doc (`features/architecture.md:37`) says "modest cache gets the hit-rate up fast" but doesn't specify a target. Tune the threshold based on the first real run; document the actual measurement; fold any adjustment into `packages/demo/fixtures/scenarios/06-cache-hitrate-sweep.json`'s `expectations` (so the threshold is data, not code).
  - **`creative_tag` rule kind is a no-op** (`features/clusterA/policy-match-evaluation.md:123`). Demo fixtures MUST NOT rely on `creative_tag` matching anything; scenario 1 uses a `category` rule, scenario 2 uses a `category` rule, etc.
  - **Foundation may not have landed `@scout/store` impls at PRP-execute time.** If so, the seeder uses a hand-rolled in-memory `Map<string, PageProfile>` keyed by `(advertiserId, contentHash)` until foundation catches up — interface-identical to `@scout/store`'s in-memory impl. Document the swap path.

- **Out of scope — file as follow-ups:**
  - **Fixture-authoring UI** (a web form to compose new scenarios) — manual JSON editing is fine for 5 scenarios; UI is overengineering.
  - **Monitoring beyond the dashboard feature** — the `dashboard-verdict-views.md` PRP owns the live verdict viewer; this PRP does not duplicate it.
  - **Multi-tenant cross-talk scenarios** — the fixture format supports it (per *Security guardrails*); v1 ships single-tenant-per-scenario. File `demo-multi-tenant-isolation.md` as a follow-up.
  - **Real OpenRTB capture + replay** — productionization story; not hackathon-scoped.
  - **Live-DPI-catch scenario** (a verifier prompt-injection that Lobster Trap visibly blocks on stage) — covered by submission-video recording in v1; file `demo-live-dpi-catch.md` if time.
  - **Scenario 6 as a stage scenario** — v1 runs scenario 6 in CI only.
  - **`assertHitRate` threshold tuning** — initial 0.75 is a guess; tune to actual measurement.
  - **Replayer running in a Docker container** — local-host process is fine for the demo machine; containerization is a polish step.
  - **WebSocket streaming of verdicts to the dashboard** — the dashboard reads `AuditStore` directly per `features/architecture.md:128-131`; no streaming needed.

- **Test order:** **ALLOW happy-path first.** If scenario 1 flakes on stage, the demo is dead before it starts — pacing collapses, the audience disengages, scenarios 2–5 are wasted. Therefore:
  1. Fixture-schema round-trip tests (every fixture parses; smallest possible failure surface).
  2. Scenario 1 (ALLOW) — replay against in-process gate; assert verdict shape + latency bound.
  3. Scenario 2 (DENY) — same shape, opposite verdict.
  4. Determinism test (scenarios 1+2 replay twice; deep-equal verdicts).
  5. Scenario 3 (Flash) — mocked `@scout/llm-client`; assert `lobstertrapTraceId` round-trip.
  6. Scenario 4 (HUMAN_REVIEW) — pre-seeded disagreement profile; assert `arbiter_disagreement` reason.
  7. Scenario 5 phase A (cache miss DENY) — clean store; assert `fail_closed`/`cache_miss`; assert queue enqueue.
  8. Scenario 5 phase B (warm-then-hit) — manual profile put; assert cache hit.
  9. Inter-scenario clear-state test (scenario 3 leaves no stale state for scenario 5).
  10. Accelerated-mode full run (1→5 back-to-back; <60s wall clock).
  11. Scenario 6 (cache hit-rate sweep) — 200 requests, Zipfian; assert ≥ 0.75 hit rate. Marked `test.skip` in default `pnpm test`; runs in `pnpm test:long`.
  12. Real-time-mode smoke (manual; runs before the night-before-stage rehearsal).
