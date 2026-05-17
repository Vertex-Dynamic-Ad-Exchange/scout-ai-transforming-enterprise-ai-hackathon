name: "Demo — PRP-B: replayer + seeder + asserts + in-process gate (TDD)"
description: |

  Second of five PRPs for `features/clusterD/demo-bidstream-seeding.md`.
  Lands the core engine of `@scout/demo`: HTTP replayer (undici keep-alive
  Agent + per-bid latency capture per feature line 194), seeder (wraps
  `@scout/store`'s `ProfileStore.put` / `PolicyStore` per feature lines 71
  + 104), verdict-shape asserts (per feature line 136), and an in-process
  gate test harness booting Fastify with the *real* `createApp(deps)`
  handler — no mocks inside the gate (feature line 15).

  **Prereq**: PRP-A (`demo-package-foundation.md`) merged — imports
  `ScenarioSchema`, `ExpectationSchema`, `RecordedBidSchema`, `demoConfig`.
  **Consumed by**: PRP-C (scenarios 1+2), PRP-D (mock `LlmClient` swaps
  in here), PRP-E (waitForProfile / assertHitRate).
  **Out of scope**: scenario fixtures (C/D/E), `--llm` flag (D), `--mode`
  flag + `run-demo.ts` + `clear-state.ts` (C), `waitForProfile` /
  `assertHitRate` (E).

  ## TDD discipline

  Red → Green → Refactor. Confirm failure mode is *expected* before impl.
  `inProcessGate.ts` lands at Task 2 BEFORE `seeder`/`replayer` full
  tests — every meaningful test of those needs Fastify with the real
  handler bound to an ephemeral `127.0.0.1` port.

  ## Why this PRP exists separately

  - **PRPs C+D+E each depend on this engine.** Without
    `replayer`/`seeder`/`asserts`/`inProcessGate`, no scenario test runs;
    every downstream PRP would stub the same four modules independently.
  - **Two seams in one PRP.** HTTP wire (undici → Fastify) + in-process
    dep wire (real `createApp` + real `createStores` + real
    `createPolicyMatcher` + stub `LlmClient`).
  - **Standalone-testable.** 1 happy + 1 edge + 1 failure per module
    (4 × 3 = 12 tests) against synthetic 1–2 bid scenarios constructed
    inline; no scenario fixtures needed.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A directly (replayer external, feature line
    11). Recording fidelity ±50ms; per-bid `latencyMs` excludes
    connection setup via shared undici `Agent` keep-alive (feature
    gotcha 194). Pinned in Task 4.
  - **Pre-bid** — Honored. Replayer drives `POST /verify` on wire
    (feature line 71); never touches agents.
  - **Plug-and-play** — Engine is HTTP-only across gate's wire boundary.
    `inProcessGate.ts` is the one file in `packages/demo/src/` allowed
    to import `@scout/{gate,store,policy,llm-client}`.
  - **Sponsor tech** — Neither directly. Stub `LlmClient.chat()` throws;
    scenarios 1+2 (PRP-B's shape) never escalate to Flash per feature
    lines 28 + 30. PRP-D swaps stub for `vi.mock` at the
    `@scout/llm-client` boundary (TODO § 2).

  ## CLAUDE.md rules that bite

  - § Stack — **`undici@^7.0.0` is a new runtime dep** (first HTTP
    client in workspace). Ask before adding; rationale = feature gotcha
    194. Native `fetch` has no explicit `Agent` for pool reuse.
  - § Working agreements — Files ≤ ~300 lines; each capped lower per
    feature lines 60–62: `replayer.ts` ≤ 200, `seeder.ts` ≤ 150,
    `asserts.ts` ≤ 100; `inProcessGate.ts` ≤ 100 (test rig).
  - Tests colocated; 1 happy + 1 edge + 1 failure per module.
  - `inProcessGate.ts` binds `127.0.0.1` only — § Security guardrails.

  ## Decisions (locked here)

  | # | Question | Locked |
  |---|---|---|
  | D1 | HTTP client | `undici@^7.0.0` + shared `Agent({ keepAliveTimeout: 60000, keepAliveMaxTimeout: 60000 })` reused across all bids in a `runScenario`. Feature gotcha 194. |
  | D2 | `ts` stamp | Stamp fresh `ts: new Date().toISOString()` per request. `--preserve-recorded-ts` deferred (`// TODO(follow-up)`). Feature gotcha 188. |
  | D3 | `ProfileStore` shape | Use `@scout/store`'s verbatim: `put(profile: PageProfile)` keyed by `profile.url` (`packages/store/src/index.ts:70-72`). TODO § 1. Cross-tenant leaks observable on wire (gate's `policyStore.get` is tenant-scoped). |
  | D4 | In-process gate composition | Real `createApp(deps)` + real `createStores()` + real `createPolicyMatcher()` + **stub `LlmClient`** (throws on `chat()`). Feature line 15. PRP-D swaps stub at module boundary (TODO § 2). |
  | D5 | Stub `LlmClient.chat()` | Throws `Error("stub LlmClient.chat() — PRP-B scenarios never escalate to Flash; PRP-D's mock for Flash")`. Silent stub would mask PRP-D regressions. |
  | D6 | `latencyMs` measurement | `Date.now() - start` where `start` captured immediately before `request()`. Excludes `delayMs` wait + queueing. Excludes connection setup (D1). Compare to `verdict.latencyMs` within ±50ms in Task 4. |
  | D7 | Error classes | `ReplayerError extends Error` (`.status`, `.detail`, `.bidIndex`). `node:assert/strict`'s built-in `AssertionError` for asserts.ts. |
  | D8 | Policy source | `packages/policy/fixtures/${id}.json` by ID. NO copy under `packages/demo/fixtures/policies/`. Feature line 65. |
  | D9 | Profile source | `packages/demo/fixtures/pages/${name}.profile.json`. Round-trips `PageProfileSchema.parse()` at seed time. |
  | D10 | Inter-bid delay | `setTimeout` promise. NOT `process.nextTick` (microtask starves loop — § Gotchas), NOT busy-wait. |
  | D11 | Policy pre-seeding | `createStores({ initialPolicies: [...] })`. NO post-construction `policyStore.put` (`@scout/store`'s `PolicyStore` has no `put`). |
  | D12 | In-process gate bind | `127.0.0.1` only. Never `0.0.0.0`. Pinned by Task 11 grep. |

  ## All Needed Context

  ```yaml
  - file: PRPs/clusterD/demo-bidstream-seeding/DEMO-BIDSTREAM-SEEDING-TODO.md
    section: "§ 1 ProfileStore (D3), § 2 LlmClient mock placement (D5
      stub calibrated), § 6 creativeRef verbatim."
  - file: features/clusterD/demo-bidstream-seeding.md
    section: "11 (external+±50ms), 15 (no mocks in gate), 56-72 (paths+
      seam), 73-88 (tests), 180-198 (security + 188 clock skew + 194
      keep-alive), 211-223 (test order)."
  - file: PRPs/clusterB/profiler-real-loop/profiler-in-memory-queue.md
    why: STYLE TEMPLATE — density, sections, decisions table, task
      numbering, validation gates.
  - file: PRPs/clusterB/profiler-real-loop/profiler-core-loop.md
    why: STYLE TEMPLATE for multi-module PRPs with TDD task ladder.
  - file: PRPs/clusterD/demo-bidstream-seeding/demo-package-foundation.md
    why: PRP-A. ScenarioSchema, RecordedBidSchema, ExpectationSchema,
      demoConfig.
  - file: packages/gate/src/index.ts
    why: createApp(deps: GateDeps) factory (4-10); rig consumes verbatim.
  - file: packages/gate/src/handler.ts
    why: Real handler. 46+86+94 production paths; 41-44 400-on-empty
      (Task 2); 149-152 500-on-exception (Task 6).
  - file: packages/store/src/index.ts
    section: "54-96 createStores; 62-63 initialPolicies; 70-72
      profileStore.put(profile); 75-79 PolicyStore has no put (D11)."
  - file: packages/shared/src/schemas/bid.ts
    why: creativeRef z.string().min(1) line 7 — verbatim (TODO § 6).
  - file: packages/shared/src/schemas/verdict.ts
    why: lobstertrapTraceId nullable line 17.
  - file: packages/shared/src/schemas/profile.ts
    why: PageProfileSchema; ttl positive line 30 — failure trigger.
  - file: packages/shared/src/schemas/policy.ts
    why: PolicySchema threaded via initialPolicies.
  - file: packages/llm-client/src/index.ts
    section: "34-52 LlmClient interface; D5 stub satisfies."
  - file: packages/policy/fixtures/brand-safe-news.json
    why: PolicySchema shape; D8 reads dir by ID.
  - url: https://undici.nodejs.org/#/docs/api/Agent
  - url: https://fastify.dev/docs/latest/Reference/Server/#listen
    why: listen({ port: 0, host: "127.0.0.1" }) → ephemeral port (string URL).
  - url: https://nodejs.org/api/assert.html#class-assertassertionerror
  ```

  ## Files to create / modify

  Create:
  - `packages/demo/src/replayer.ts` (≤ 200)
  - `packages/demo/src/seeder.ts` (≤ 150)
  - `packages/demo/src/asserts.ts` (≤ 100)
  - `packages/demo/src/inProcessGate.ts` (≤ 100; test rig — NOT in barrel)
  - `packages/demo/src/errors.ts` (≤ 30)
  - `packages/demo/src/__tests__/{replayer,seeder,asserts,inProcessGate}.test.ts`

  Modify:
  - `packages/demo/package.json` — add `undici@^7.0.0` to `dependencies`;
    `@scout/store` to `dependencies` (seeder return type leaks publicly);
    `@scout/{gate,policy,llm-client}` (workspace) + `fastify` to
    `devDependencies` (test rig only).
  - `packages/demo/src/index.ts` — append `export * from
    "./{replayer,seeder,asserts,errors}.js"`. `inProcessGate` NOT exported.

  ## Target contracts

  ```ts
  // errors.ts
  export class ReplayerError extends Error {
    readonly status: number; readonly detail: unknown; readonly bidIndex: number;
    constructor(msg: string, status: number, detail: unknown, bidIndex: number) {
      super(msg); this.name = "ReplayerError";
      this.status = status; this.detail = detail; this.bidIndex = bidIndex;
    }
  }
  // replayer.ts
  export interface BidResult { request: BidVerificationRequest; verdict: VerificationVerdict;
    latencyMs: number; sentAt: string /* ISO-8601 */; receivedAt: string }
  export interface RunScenarioOptions { gateUrl: string; signal?: AbortSignal }
  export function runScenario(scenario: Scenario, opts: RunScenarioOptions): Promise<BidResult[]>;
  // seeder.ts
  export interface SeederStores { profileStore: ProfileStore; policyStore: PolicyStore }
  export function seedScenario(scenario: Scenario, stores: SeederStores): Promise<void>;
  /** Parsed Policy[] ready to thread into createStores({ initialPolicies }). */
  export function seedPolicies(scenario: Scenario): Promise<Policy[]>;
  // asserts.ts — throws AssertionError on first mismatch
  export function assertVerdict(verdict: VerificationVerdict, expectation: Expectation): void;
  // inProcessGate.ts (test rig)
  export interface InProcessGateHandle { url: string /* http://127.0.0.1:<eph> */;
    stores: ReturnType<typeof import("@scout/store").createStores>; stop(): Promise<void> }
  export interface InProcessGateOptions { initialPolicies?: Policy[] }
  export function startInProcessGate(opts?: InProcessGateOptions): Promise<InProcessGateHandle>;
  ```

  ## Task order (TDD; commit-sized)

  ### Task 1 — Deps + `ReplayerError` + barrel

  **Red.** `import { ReplayerError } from "@scout/demo"`; instantiate.
  **Green.** Add deps per Files; land `errors.ts`; append to barrel.

  ### Task 2 — `inProcessGate.ts` happy path

  **Red.** `startInProcessGate()` → POST `{}` to `${handle.url}/verify`
  → expect 400 (empty-body, `handler.ts:41-44`). `handle.stop()` resolves.
  **Green.** `createStores({ initialPolicies: opts?.initialPolicies })`;
  build `stubLlmClient` (D5: `chat` throws, `healthcheck` returns ok);
  `createApp({ ...stores, llmClient: stubLlmClient, policyMatcher:
  createPolicyMatcher() })`; `await app.listen({ port: 0, host:
  "127.0.0.1" })` (D12); return `{ url, stores, stop: () => app.close() }`.

  ### Task 3 — `inProcessGate.ts` edge + failure

  **Edge.** `stop()` twice → second resolves (no throw).
  **Failure.** Two concurrent `startInProcessGate()` → distinct `url`s.
  **Green.** No new code; Fastify `close()` idempotent + `listen({ port:
  0 })` distinct ports. If edge flakes, add `stopped` guard.

  ### Task 4 — `replayer.ts` happy path

  **Red.** Inline 2-bid `Scenario` (empty `seeds`); both `pageUrl`s have
  no profile → both verdicts `fail_closed`/`cache_miss`
  (`handler.ts:48-64`). Assert `results.length === 2`; both `latencyMs >
  0`; valid ISO-8601 `sentAt`/`receivedAt`; both decisions `"DENY"`.
  Assert `|results[i].latencyMs - results[i].verdict.latencyMs| < 50`
  (D6 + feature line 11).

  **Green.** Construct one `Agent` (D1) outside the loop; iterate
  `scenario.bids`; per bid: `await setTimeout(delayMs)` (D10); rewrite
  `ts` (D2); capture `sentAt` + `start = Date.now()`; `undiciRequest(...
  ${gateUrl}/verify, { method, dispatcher: agent, body, signal })`;
  compute `latencyMs = Date.now() - start` (D6) + `receivedAt`; on
  non-2xx throw `ReplayerError` (D7); push `BidResult`. `finally`
  `await agent.close()`.

  ### Task 5 — `replayer.ts` edge: `delayMs` honored

  **Red.** 2-bid with `bids[1].delayMs = 50`. Assert `Date.parse(sentAt[1])
  - Date.parse(sentAt[0]) >= 45` (5ms jitter, D10).
  **Green.** `setTimeout` already in Task 4; pins regression.

  ### Task 6 — `replayer.ts` failure: gate 500 → `ReplayerError`

  **Red.** Boot rig with a profile + policy whose `category` rule
  confidence is below `humanReviewThreshold` → matcher escalates to
  Flash (`handler.ts:133-138`). Stub `chat()` throws → handler `catch`
  returns 500 with `failClosedVerdict("handler_exception")`
  (`handler.ts:149-152`). Assert `ReplayerError` thrown, `.status ===
  500`, `.detail` parseable as `VerificationVerdict` with
  `reasons[0].ref === "handler_exception"`, `.bidIndex === 0`.
  **Green.** `ReplayerError` already thrown in Task 4 impl.

  ### Task 7 — `seeder.ts` happy path

  **Red.** Write `_test-seeder-happy.profile.json` under
  `packages/demo/fixtures/pages/` (`_test-` prefix isolates from PRPs
  C–E's real corpus). Inline `Policy` threaded via `createStores({
  initialPolicies: [policy] })`. `Scenario.seeds.profiles =
  ["_test-seeder-happy"]`, `seeds.policies = [policy.id]`. Call
  `seedScenario`; assert `profileStore.get(profile.url)` returns the
  profile; `policyStore.get(policy.id, policy.advertiserId)` returns it.

  **Green.** `seedScenario`: for each `name` in `s.seeds.profiles` read
  `packages/demo/fixtures/pages/${name}.profile.json`,
  `PageProfileSchema.parse`, `profileStore.put(profile)` (D3, D9).
  `seedPolicies` (separate fn, runs BEFORE `createStores` per D11): for
  each `id` in `s.seeds.policies` read
  `packages/policy/fixtures/${id}.json` (D8), `PolicySchema.parse`,
  return array.

  ### Task 8 — `seeder.ts` edge: idempotent re-seed

  **Red.** Call `seedScenario` twice; no throw; latest write returned.
  **Green.** No new code — `Map.set` latest-write-wins (store:71).

  ### Task 9 — `seeder.ts` failure: malformed fixture

  **Red.** Write `_test-seeder-malformed.profile.json` with `ttl: -1`
  (violates `PageProfileSchema:30` `.positive()`). Call `seedScenario`;
  assert `ZodError` thrown; `profileStore.get(url)` still `null`
  (never reached `.put`).
  **Green.** No new code — `PageProfileSchema.parse` throws.

  ### Task 10 — `asserts.ts` happy + edge + failure

  **Happy.** Verdict + expectation align on every field; no throw.
  **Edge (superset).** Expectation `reasonKinds: ["profile_signal"]`;
  verdict `reasons: [{kind:"profile_signal",...},{kind:"policy_rule",...}]`.
  No throw.
  **Failure.** `verdict.latencyMs = 500`, `expectation.latencyMsMax =
  300`. `AssertionError` thrown; message contains both `500` and `300`.

  **Green.** `assert.equal(v.decision, e.decision)`; iterate
  `e.reasonKinds` checking superset of `new Set(v.reasons.map(r=>r.kind))`
  → throw `AssertionError({ message, actual, expected })` on miss;
  compare `v.latencyMs > e.latencyMsMax` → throw with both numbers in
  the message; branch on `e.lobstertrapTraceIdNullable` (`true` →
  `assert.equal(v.lobstertrapTraceId, null)`; `false` → assert non-empty
  string).

  ### Task 11 — Validation sweep

  See § Validation gates. Plus `wc -l
  packages/demo/src/{replayer,seeder,asserts,inProcessGate,errors}.ts`
  against the file caps.

  ## Validation gates (executable)

  - `pnpm --filter @scout/demo test` — 12 tests green.
  - `pnpm -r exec tsc --noEmit` + `pnpm -r exec eslint . --fix` +
    `pnpm -r build` — clean.
  - `pnpm audit` — no high/critical on undici (clean at 7.0.0).
  - `grep -rn 'process\.env' packages/demo/src` → only PRP-A `config.ts`.
  - `grep -rn '0\.0\.0\.0' packages/demo/src` → empty (D12).
  - File caps per Files.

  ## Security guardrails

  - **No secrets in fixtures.** PRP-A's CI grep (feature line 181); the
    `_test-*.profile.json` files added here contain none.
  - **`DEMO_GATE_URL` URL-validated at config-read time** by PRP-A's
    `demoConfig`. PRP-B re-uses via barrel; never re-reads `process.env`.
  - **No `process.env.*` outside PRP-A's `config.ts`** — pinned grep.
  - **`inProcessGate.ts` binds `127.0.0.1` only** (D12). Test rigs on
    LAN are a hackathon-day data-leak class (convention-center Wi-Fi
    enumerable). Pinned grep on `0.0.0.0`.
  - **Replayer NEVER logs response bodies.** Verdict payloads carry
    advertiser-policy refs + creative metadata. On `ReplayerError` body
    goes in `.detail` (caller may log); `replayer.ts` itself emits no
    `console.log`.
  - **Tenant-scoped seeding observable on the wire.** Format supports
    multi-tenant (feature line 182); gate's `policyStore.get(policyId,
    advertiserId)` enforces at request time (`handler.ts:86`); cross-
    tenant leak visible as `fail_closed`/`tenant_mismatch` (line 89).
  - **Stub `LlmClient.chat()` throws loudly** (D5). Silent stub would
    mask PRP-D regressions where a PRP-B scenario escalated to Flash.

  ## Gotchas

  - **undici keep-alive ↔ `latencyMs` assertion** (feature 194). Per-bid
    `Agent` (or native `fetch` without `keepAlive`) creeps latency
    5–15ms; ±50ms fidelity (feature 11) flakes. Task 4 asserts
    `|latencyMs - verdict.latencyMs| < 50`.
  - **`inProcessGate` cleanup.** `afterAll(async () => await
    handle?.stop())` in every file; missing it leaks Fastify ports.
  - **`setImmediate`/`setTimeout` for `delayMs`** fine (D10);
    `process.nextTick` NOT — microtask starves loop, blocks undici
    socket reads. Contributor "optimizing" `setTimeout` away deadlocks.
  - **Per-bid `latencyMs` matches `verdict.latencyMs` within a few ms**
    in-process. Real-network gate would invalidate the Task 4 assertion;
    `127.0.0.1`-only test holds.
  - **`@scout/store`'s `ProfileStore.put(profile)`** (D3 + TODO § 1) NO
    `advertiserId` arg. Foundation reconciliation mid-PRP changes one
    callsite; test rig is the guard.
  - **Fastify `listen({ port: 0 })` returns string URL.** Use returned
    string as `handle.url`; don't reconstruct from port.
  - **PRP-B fixtures use `_test-` prefix.** PRPs C–E author real
    `news-site.profile.json` etc. — never overwrite. `grep -l '^_test-'`
    at PRP-C start confirms isolation.

  ## Out of scope — file as follow-ups

  - **`--preserve-recorded-ts` flag** (D2). `// TODO(follow-up)` marker;
    file `demo-preserve-recorded-ts.md` when captured-OpenRTB lands.
  - **WebSocket streaming** (feature 209) — dashboard reads `AuditStore`
    directly (`features/architecture.md:128-131`).
  - **Replayer in Docker** (feature 208).
  - **Scenario fixtures** (`01-clean-allow.json` …) — PRPs C/D/E.
  - **`--llm=real|mock`** — PRP-D. Stub (D5) is PRP-B placeholder.
  - **`--mode realtime|accelerated`** — PRP-C. `runScenario` is
    mode-agnostic; PRP-C wraps with pacing.
  - **`run-demo.ts` / `clear-state.ts`** — PRP-C; `inProcessGate` is
    test-only.
  - **`waitForProfile.ts` / `assertHitRate.ts` / `zipfian.ts`** — PRP-E.
  - **`ProfileStore` shape reconciliation** (TODO § 1) — foundation.

  ## Anti-Patterns

  - **Don't mock the gate** (feature 15 + D4). Rig uses real
    `createApp` + real `createStores` + real `createPolicyMatcher`. Only
    stub = `LlmClient` (D5); PRP-D swaps at module boundary, NOT
    OpenAI-SDK layer (TODO § 2).
  - **Don't import `@scout/{gate,store,policy,llm-client}` from
    production code in `packages/demo/src/`** outside `inProcessGate.ts`.
    Test rig only. PRP-C's `run-demo.ts` drives the production gate
    over HTTP.
  - **Don't log `verdict` payloads** (§ Security).
  - **Don't synthesize `creativeRef`** (TODO § 6). Verbatim only;
    synthesized ULID breaks audit-row determinism across runs.
  - **Don't wire `--llm`** (PRP-D) or `--mode realtime|accelerated`
    (PRP-C).
  - **Don't author scenario fixtures here** — `_test-seeder-*` only.
  - **Don't `new Agent()` per-bid** (D1). One per `runScenario`; close
    in `finally`.
  - **Don't busy-wait `delayMs`** (D10); don't bind `0.0.0.0` (D12);
    don't `process.env.*` outside PRP-A's `config.ts`.
  - **Don't post-construction `policyStore.put`** (D11). No `put` API;
    `createStores({ initialPolicies })` is the only path.

  ## Confidence: 7 / 10

  Strengths: four small modules with clean seams; `inProcessGate` uses
  the real production handler (no behavioural drift); `node:assert/strict`
  + zod keep dep surface minimal; ephemeral `127.0.0.1` = free
  parallel-test isolation.

  Risks:
  - **R1 — `ProfileStore` shape drift (TODO § 1).** Seeder uses
    `@scout/store`'s `put(profile)` (D3); foundation reconciliation to
    two-arg shape mid-PRP changes one callsite; PRPs C–E may start
    against old shape. Lock D3 before PRP-C starts.
  - **R2 — undici keep-alive perf assertion.** Task 4's `< 50ms` could
    flake on slow CI; bump to 100ms if needed but file the regression
    — `Agent` reuse is the real fix.
  - **R3 — Two new module seams in one PRP.** HTTP wire (undici →
    Fastify) + in-process dep wire (real stores + stub `LlmClient`)
    both land here. Task 2 lands `inProcessGate` first; if it reveals
    `createApp` API drift, downstream tasks block. Ordered to surface
    seam cost up-front.
