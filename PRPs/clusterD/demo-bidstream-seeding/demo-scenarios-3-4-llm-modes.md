name: "Demo — PRP-D: scenarios 3+4 + `--llm=real|mock` mode (TDD)"
description: |

  Fourth of five PRPs implementing `features/clusterD/demo-bidstream-seeding.md`.
  Lands scenario 3 (Gemini Flash on the hot path → Track 2 / Gemini
  Award) and scenario 4 (HUMAN_REVIEW arbiter disagreement → Track 1
  / Veea Award) plus the `--llm=real|mock` flag infrastructure that
  lets the on-stage cut run offline per feature lines 162–163
  (recommendation C: hybrid mock-on-stage / real-in-video). Authors
  cross-package policy fixture
  `packages/policy/fixtures/politics-borderline.json` per TODO §
  Cross-PRP coordination 3.

  **Source spec:** feature lines 31–41 (scenarios), 73–88 (tests —
  79–80 for 3+4), 149–151 (sponsor-tech BOTH), 159–163 (option C
  hybrid), 176–178 (prize mapping), 187–198 (gotchas — line 192
  `vi.mock` scope is load-bearing).

  **Prereqs**: PRP-A (`ScenarioSchema`, `ExpectationSchema`,
  `formatVersion: "1.0"`); PRP-B (`inProcessGate.ts`, `seeder.ts`,
  `asserts.ts`); PRP-C (`runScenario.ts`, scenarios 1+2). Block on
  PRP-C merge before Task 9. **Follow-up**: PRP-E uses `--llm=real`
  for the submission-video recording of scenario 5 phase A.

  ## TDD discipline

  Red → Green → Refactor. Confirm red fails for the *expected reason*
  (`ERR_MODULE_NOT_FOUND` / `TS2307` / mismatched assertion). Each
  scenario: 1 happy (prize-narrative bullet), 1 edge (mock-leak
  regression for 3; sparse-categories ordering for 4), 1 failure
  (`resolveLlmClient("real")` throws without `GEMINI_API_KEY`).

  ## Why this PRP exists separately

  First PRP exercising **both** prize narratives in one file. Isolates
  the `vi.mock` mock-discipline concern (TODO § 2): a leaked mock from
  scenario 3 into scenario 1 silently turns scenario 1 into "Flash was
  called for an ALLOW that shouldn't have called Flash" (feature line
  192). Unblocks PRP-E: scenario 5 phase A's submission-video recording
  needs the `--llm=real` flag wired here.

  ## Hackathon constraint check

  - **Sub-second SLA** — Scenario 3 asserts `latencyMs < 900` (feature
    line 34). Gate's `escalateToFlash` completes inside its 400ms
    abort + replayer overhead. Mock returns synchronously (~0ms).
  - **Pre-bid, not post-impression** — Flash call happens inside the
    gate handler, before verdict returns.
  - **Plug-and-play** — Mock sits at the `@scout/llm-client` module
    boundary (TODO § 2). `--llm=real` swap touches no scenarios.
  - **Sponsor tech — BOTH (only PRP lighting both prize paths):**
    Track 2 (Gemini) — scenario 3's non-null `lobstertrapTraceId`
    round-trip. Track 1 (Veea) — scenario 4's `arbiter_disagreement`
    HUMAN_REVIEW verdict ("independent verification, not three
    rubber-stamps").

  ## CLAUDE.md rules that bite

  - § Working agreements: files ≤ ~300 lines. `llmMock.ts` ≤ 80;
    `llmMode.ts` ≤ 40; each test file ≤ 150.
  - § Stack: no new runtime deps. Mock implements an existing
    interface; mode resolver dynamic-imports an existing factory.
  - § Hard constraints: "No secrets in any client/UI code." Mock
    reads no env; real-mode reads `GEMINI_API_KEY` only inside
    `@scout/llm-client`'s own `config.ts`.

  ## Decisions (locked here)

  | # | Question | Locked answer | Why |
  |---|---|---|---|
  | D1 | `vi.mock` placement | `@scout/llm-client` module boundary (TODO § 2 + feature line 79). NOT OpenAI SDK, NOT LT proxy. | Gate's `LlmClient` call must traverse the same boundary at test as runtime — else `Reason{ref:"lobstertrap_denied"}` isn't exercisable. |
  | D2 | Stage default `--llm` | `mock`. | Feature line 195: stage MUST run without network. |
  | D3 | Video default `--llm` | `real`. | Feature line 163 hybrid C. |
  | D4 | Mock scenario-3 decision | Pin `ALLOW` (`content: '{"decision":"ALLOW"}'`). | Feature line 34 admits non-determinism with real Flash but asks for bounded assertion. Future variants add `ExpectationSchema.decisionAllowList` (PRP-A follow-up). |
  | D5 | Mock trace ID generation | Module-scoped counter `lt_mock_${++counter}`. Deterministic within a test; resets per file via `vi.resetModules()`. | Pinned strings allow regex `^lt_mock_/` assertion. Reset by design. |
  | D6 | `resolveLlmClient("real")` on missing key | Throws. Names the var; NEVER prints value. | Feature line 189: never fail-soft. Rehearsal logs get screenshotted. |
  | D7 | Cross-package policy fixture | Created here (TODO § 3). Task 1 greps first; skips on hit. | Policy-match PRP may land it independently. |
  | D8 | Scenario 4 gate codepath | `dom_snippet` triggers existing `hasPriorArbiterDisagreement` at `handler.ts:25-27`; short-circuits HUMAN_REVIEW at `handler.ts:66` before policy match. | Reuse the codepath. Sparse `categories[]` keeps intent unambiguous (handler order: lookup → ttl → disagreement → policy match). |
  | D9 | Scenario 4 `lobstertrapTraceId` | `null`. | Gate emits null on disagreement-marker path (`handler.ts:79`). "Chain of four trace IDs" (feature line 40) surfaces in dashboard from prior arbiter audit row, not in this verdict. |
  | D10 | Real-mode LLM client import | `await import("@scout/llm-client")` inside `resolveLlmClient`. Mock mode does NOT touch the real package. | Top-level import pulls OpenAI SDK + fetch transport even on mock runs. |
  | D11 | Mock-leak regression test exists | Yes — runs scenario 1 AFTER `vi.mock` + `vi.resetModules()` + `vi.unmock()`; asserts `lobstertrapTraceId === null`. | Feature line 192 names this failure. |
  | D12 | `inProcessGate.start()` injects `llmClient` | Yes. PRP-B signature extended to `start(opts?: { llmClient?: LlmClient })`. Throwing-stub default preserved. | Tests inject mock directly; orchestrator wires resolved client through. |

  ## All Needed Context

  ```yaml
  - file: features/clusterD/demo-bidstream-seeding.md
    section: "31–41 (scenarios); 73–88 (tests); 149–151 (sponsor BOTH);
      159–163 (option C); 176–178 (prize mapping); 187–198 (gotchas;
      line 192 vi.mock scope load-bearing)."
    why: Source spec. Every assertion traces here.
  - file: PRPs/clusterD/demo-bidstream-seeding/DEMO-BIDSTREAM-SEEDING-TODO.md
    section: "§ Cross-PRP 2 (vi.mock module boundary); § 3 (fixture)."
    why: Coordination with sibling PRPs.
  - file: PRPs/clusterB/profiler-real-loop/profiler-cost-ttl-retry.md
    why: Structural precedent — TDD task list + decisions + contracts.
  - file: packages/llm-client/src/index.ts
    section: "1–80 — LlmClient interface + types."
    why: Mock implements this interface verbatim.
  - file: packages/policy/fixtures/brand-safe-news.json
    why: Shape template for politics-borderline.json.
  - file: packages/policy/fixtures/permissive-baseline.json
    why: Scenario 4 references by ID (feature line 107).
  - file: packages/shared/src/schemas/policy.ts
    why: PolicySchema (escalation.ambiguousAction + humanReviewThreshold).
  - file: packages/shared/src/schemas/profile.ts
    why: PageProfileSchema; EvidenceRefSchema kind has "dom_snippet".
  - file: packages/shared/src/schemas/verdict.ts
    why: ReasonSchema.kind has "arbiter_disagreement".
  - file: packages/gate/src/handler.ts
    section: "25–27 (predicate); 66–82 (codepath scenario 4 triggers;
      emits lobstertrapTraceId: null)."
    why: D8 + D9 anchored here.
  - url: https://vitest.dev/api/vi.html#vi-mock
    why: Module-boundary mock placement.
  - url: https://vitest.dev/api/vi.html#vi-resetmodules
    why: D11 afterEach reset prevents cross-file leak.
  ```

  ## Files to create / modify

  **Create:** `packages/demo/fixtures/scenarios/03-ambiguous-flash.json`;
  `04-human-review-disagreement.json`;
  `packages/demo/fixtures/pages/politics-borderline.profile.json`;
  `disputed-news.profile.json`;
  `packages/policy/fixtures/politics-borderline.json` *(skip if exists per D7)*;
  `packages/demo/src/llmMock.ts` + `__tests__/llmMock.test.ts`;
  `packages/demo/src/llmMode.ts`;
  `packages/demo/src/__tests__/{scenario-03,scenario-04,mock-leak-regression}.test.ts`.

  **Modify:** `runScenario.ts` (accept `opts.llmMode`, resolve client,
  thread into gate); `inProcessGate.ts` (accept `opts?.llmClient`);
  `scripts/run-demo.ts` (parse `--llm=real|mock`, default `mock` per
  D2); `src/index.ts` (re-export `createMockLlmClient`,
  `resolveLlmClient` for PRP-E).

  ## Target fixture content

  **`fixtures/scenarios/03-ambiguous-flash.json`:**

  ```json
  {
    "formatVersion": "1.0",
    "name": "03-ambiguous-flash",
    "description": "Gate escalates to Gemini Flash inside the 400ms budget; lobstertrapTraceId round-trips. Track 2 / Gemini Award moment.",
    "seeds": { "profiles": ["politics-borderline"], "policies": ["politics-borderline"] },
    "bids": [{ "delayMs": 0, "request": { "advertiserId": "advertiser-political-cautious", "policyId": "policy-politics-borderline", "pageUrl": "https://example.com/news/politics/borderline-op-ed", "creativeRef": "creative-01HMXY3FLASH0000000000", "geo": "US", "ts": "2026-05-17T15:00:00.000Z" } }],
    "expectations": [{ "decision": "ALLOW", "reasonKinds": ["profile_signal", "policy_rule"], "latencyMsMax": 900, "lobstertrapTraceIdNullable": false }]
  }
  ```

  **`fixtures/scenarios/04-human-review-disagreement.json`:**

  ```json
  {
    "formatVersion": "1.0",
    "name": "04-human-review-disagreement",
    "description": "Pre-seeded dom_snippet evidence ref triggers gate's hasPriorArbiterDisagreement codepath; HUMAN_REVIEW. Track 1 / Veea Award moment.",
    "seeds": { "profiles": ["disputed-news"], "policies": ["permissive-baseline"] },
    "bids": [{ "delayMs": 0, "request": { "advertiserId": "advertiser-exploratory", "policyId": "policy-permissive-baseline", "pageUrl": "https://example.com/news/disputed/arbiter-disagreement-1", "creativeRef": "creative-01HMXY4HUMANREVIEW0000", "geo": "US", "ts": "2026-05-17T15:00:30.000Z" } }],
    "expectations": [{ "decision": "HUMAN_REVIEW", "reasonKinds": ["arbiter_disagreement"], "latencyMsMax": 300, "lobstertrapTraceIdNullable": true }]
  }
  ```

  **`fixtures/pages/politics-borderline.profile.json`:**

  ```json
  {
    "id": "profile-politics-borderline-01",
    "url": "https://example.com/news/politics/borderline-op-ed",
    "contentHash": "sha256:politics-borderline-fixture-2026-05-17",
    "categories": [{ "label": "politics", "confidence": 0.42 }],
    "detectedEntities": [], "evidenceRefs": [],
    "capturedAt": "2026-05-17T14:55:00.000Z", "ttl": 21600
  }
  ```

  **`fixtures/pages/disputed-news.profile.json`:**

  ```json
  {
    "id": "profile-disputed-news-01",
    "url": "https://example.com/news/disputed/arbiter-disagreement-1",
    "contentHash": "sha256:disputed-news-fixture-2026-05-17",
    "categories": [{ "label": "news", "confidence": 0.55 }],
    "detectedEntities": [],
    "evidenceRefs": [{ "kind": "dom_snippet", "uri": "evidence://disputed-news/arbiter-disagreement-1" }],
    "capturedAt": "2026-05-17T14:55:30.000Z", "ttl": 21600
  }
  ```

  **`packages/policy/fixtures/politics-borderline.json`** *(skip if exists):*

  ```json
  {
    "id": "policy-politics-borderline",
    "version": "2026-05-17.1",
    "advertiserId": "advertiser-political-cautious",
    "rules": [{ "id": "allow-politics-category", "kind": "category", "match": "politics", "action": "ALLOW" }],
    "escalation": { "ambiguousAction": "DENY", "humanReviewThreshold": 0.5 }
  }
  ```

  ## Target contracts — `llmMock` + `llmMode`

  **`packages/demo/src/llmMock.ts`:**

  ```ts
  import type { LlmClient, LlmChatArgs, LlmChatResult, LobstertrapDeclaredIntent } from "@scout/llm-client";
  let counter = 0;
  export function createMockLlmClient(): LlmClient {
    return {
      async chat(_args: LlmChatArgs, _intent: LobstertrapDeclaredIntent): Promise<LlmChatResult> {
        counter += 1;
        return { content: '{"decision":"ALLOW"}', lobstertrapTraceId: `lt_mock_${counter}`, verdict: "ALLOW", usage: { prompt_tokens: 0, completion_tokens: 0 } };
      },
      async healthcheck() { return { ok: true, lobstertrapVersion: "mock-0.0.0" }; },
    };
  }
  ```

  **`packages/demo/src/llmMode.ts`:**

  ```ts
  import type { LlmClient } from "@scout/llm-client";
  import { createMockLlmClient } from "./llmMock.js";
  export type LlmMode = "real" | "mock";
  export async function resolveLlmClient(mode: LlmMode): Promise<LlmClient> {
    if (mode === "mock") return createMockLlmClient();
    if (!process.env["GEMINI_API_KEY"]) throw new Error('resolveLlmClient("real") requires GEMINI_API_KEY env var');
    const mod = await import("@scout/llm-client");
    return mod.createLlmClient();
  }
  ```

  **`runScenario.ts` (modify) + `scripts/run-demo.ts` (modify):**

  ```ts
  // runScenario.ts:
  export async function runScenario(scenario: Scenario, opts: { llmMode?: LlmMode } = {}): Promise<ScenarioResult> {
    const llmClient = await resolveLlmClient(opts.llmMode ?? "mock");
    const gate = await inProcessGate.start({ llmClient });
    // ... rest of PRP-C body unchanged
  }
  // scripts/run-demo.ts:
  const llmArg = process.argv.find((a) => a.startsWith("--llm="));
  const llmMode: LlmMode = llmArg?.split("=")[1] === "real" ? "real" : "mock";
  await runAllScenarios({ llmMode, mode });
  ```

  ## Task order (TDD; commit-sized)

  1. **Policy fixture (cross-package).** Grep
     `packages/policy/fixtures/` for `politics-borderline.json`. If
     absent, author it (D7). Add `PolicySchema.parse` round-trip in
     `packages/policy/src/__tests__/fixtures.test.ts`.
  2. **Page profile fixtures.** Author both. Extend PRP-C's
     `__tests__/fixtures.test.ts` to round-trip via
     `PageProfileSchema.parse`.
  3. **Scenario fixtures.** Author both. Extend the same suite for
     `ScenarioSchema.parse`.
  4. **`llmMock.ts` + tests.** Red: happy (pinned shape), edge (two
     calls → DIFFERENT trace IDs). Green.
  5. **`llmMode.ts` + tests.** Red: failure —
     `vi.stubEnv("GEMINI_API_KEY", "")`; `resolveLlmClient("real")`
     throws with message containing `"GEMINI_API_KEY"`. Edge:
     `resolveLlmClient("mock")` returns a `LlmClient` matching mock
     contract. Green.
  6. **Scenario 4 test (no mock — simpler path first per feature
     lines 211–220).** Red: boots PRP-B's `inProcessGate`, seeds
     `disputed-news.profile.json` + `policy-permissive-baseline`,
     fires one bid, asserts `decision === "HUMAN_REVIEW"`,
     `reasons[0].kind === "arbiter_disagreement"`,
     `lobstertrapTraceId === null` (D9). Green via Cluster A
     codepath at `handler.ts:66-82`.
  7. **Scenario 3 test (with `vi.mock`).** Red:
     `vi.mock("@scout/llm-client", () => ({ createLlmClient: () => createMockLlmClient() }))`
     at top (TODO § 2); `afterEach(() => vi.resetModules())` per
     feature line 192. Seeds `politics-borderline.profile.json` +
     `policy-politics-borderline`; asserts `decision === "ALLOW"`
     (D4), `lobstertrapTraceId` matches `^lt_mock_/` (D5),
     `latencyMs < 900`. Green.
  8. **Mock-leak regression test.** Red: scoped `vi.mock` →
     `vi.resetModules()` → `vi.unmock()` → re-run scenario 1
     (PRP-C); assert `lobstertrapTraceId === null`. Green.
  9. **Orchestrator `--llm` wiring + smoke.** Modify per *Target
     contracts*. Manual: `pnpm demo --mode accelerated --llm=mock`
     runs 1–4 green. `--llm=real` smoke NOT required for PR; assert
     via grep that flag parsing exists.
  10. **Validation gates.** See next section.

  ## Validation gates (executable)

  ```bash
  pnpm --filter @scout/demo test
  pnpm --filter @scout/policy test               # politics-borderline round-trip
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r build
  pnpm audit
  grep -rn "process\\.env" packages/demo/src      # only inside llmMode.ts
  grep -rn "API_KEY\\|secret\\|bearer" packages/demo/fixtures packages/policy/fixtures/politics-borderline.json   # 0 hits
  pnpm demo --mode accelerated --llm=mock        # manual: 1–4 green (no network)
  pnpm demo --mode accelerated --llm=real        # manual; requires GEMINI_API_KEY; NOT required for PR
  ```

  ## Security guardrails

  - **`--llm=real` requires `GEMINI_API_KEY`.** Loaded by
    `@scout/llm-client`'s `config.ts`, NEVER by `packages/demo/**`
    except the fail-loud check in `llmMode.ts` (reads env only to
    decide whether to throw; never logs value).
  - **Mock reads no secret env.** Asserted by `grep -rn "process\\.env"
    packages/demo/src` — expected exactly one hit (`llmMode.ts`).
  - **No secrets in fixtures.** Asserted by validation grep.
  - **Synthetic placeholder URIs.** Scenario 4's `dom_snippet` URI is
    `evidence://disputed-news/...` — never real page content per
    feature line 183.
  - **Visibly synthetic mock trace IDs.** `lt_mock_${n}` can't be
    mistaken for real Lobster Trap IDs; operators grep to filter
    test traffic.
  - **Tenant scoping unchanged.** Scenario 3's `advertiserId` matches
    new policy's; scenario 4's matches `permissive-baseline`'s.
    Cross-tenant hits Cluster A's fail-closed at `handler.ts:87-91`.

  ## Gotchas

  - **`vi.mock` scope (feature line 192).** `vi.resetModules()` MUST
    run in `afterEach` for `scenario-03.test.ts`. Without it, a later
    file imports the mocked client — scenario 1 silently turns into
    "Flash was called for an ALLOW that shouldn't have called Flash."
    Task 8's regression pins this.
  - **Scenario 4 categories MUST be sparse.** Handler order: lookup
    → ttl → **disagreement (FIRST)** → policy match. `dom_snippet`
    short-circuits at `handler.ts:66`. Richer `categories[]` would
    still hit it but muddies test intent (feature line 39).
  - **Cross-package fixture authoring.** Task 1 MUST grep for existing
    `politics-borderline.json` before creating (TODO § 3).
  - **Counter reset per file is correct.** Module-scoped counter
    resets when `vi.resetModules()` re-imports — by design (D5).
    Scenario 3 asserts via regex `^lt_mock_/`, not exact string.
  - **`GEMINI_API_KEY` empty vs unset.** `process.env["X"] === ""`
    differs from `undefined`. D6's `if (!process.env[...])` catches
    both. Task 5 pins the empty-string branch.
  - **Dynamic import side effects.** `await import("@scout/llm-client")`
    triggers top-level `OpenAI` constructor allocation. Mock mode
    MUST NOT take this path; D10 enforces.
  - **Scenario 3's `latencyMsMax: 900` is generous.** Mock is
    synchronous (~0ms); 900ms cap exists for real-mode (feature line
    34 Flash bound `[200, 900]`).

  ## Out of scope — file as follow-ups

  - **Scenarios 5+6** (PRP-E): cache-miss DENY-then-warm + Zipfian.
  - **`waitForProfile.ts`** (PRP-E): poll-vs-sleep per TODO § 4.
  - **`assertHitRate.ts`** (PRP-E): wire-shape hit-rate counter.
  - **`ExpectationSchema.decisionAllowList`** (PRP-A follow-up):
    only if a future scenario 3 variant accepts both ALLOW and DENY
    from real Flash. v1 pins ALLOW per D4.
  - **Live-DPI-catch scenario** (feature line 205): covered by
    submission-video clip in v1.
  - **Jitter simulation in mock** — only if `latencyMsMax: 900`
    proves too loose.
  - **Multi-tenant cross-talk scenarios** (feature line 203):
    `demo-multi-tenant-isolation.md`.
  - **Real-Gemini stage demo.** Feature line 163: mock-on-stage,
    real-in-video. Do NOT use `--llm=real` on stage.

  ## Anti-Patterns

  - **Don't mock at the OpenAI SDK layer** — bypasses gate's Lobster
    Trap `Reason{ref:"lobstertrap_denied"}` codepath. D1.
  - **Don't mock inside the Lobster Trap proxy seam** — same reason;
    the proxy IS the seam under test.
  - **Don't pin scenario 3's `decision` to a non-deterministic
    real-Flash value.** Mock + assert strict `ALLOW` (D4).
  - **Don't add policy-ALLOW-matching categories to scenario 4's
    profile.** Muddies test intent (feature line 39).
  - **Don't top-level-import `@scout/llm-client` in `runScenario.ts`.**
    D10 — use dynamic import via `llmMode.ts`.
  - **Don't omit `vi.resetModules()` in `scenario-03.test.ts`'s
    `afterEach`.** Feature line 192.
  - **Don't author a new gate codepath for scenario 4.** Reuse
    existing predicate at `handler.ts:25-27`. D8.
  - **Don't print `GEMINI_API_KEY`'s value in the failure message.**
    D6 — name the variable only.

  ## Confidence: 7 / 10

  Three risks: (a) `vi.mock` discipline is fragile — Task 8's
  regression pins the failure mode, but new sibling tests must
  remember `afterEach`; (b) cross-package policy fixture (Task 1)
  needs grep-coordination with policy-match-evaluation PRP — silent
  overwrite is worst-case; (c) scenario 4 depends on Cluster A's
  `hasPriorArbiterDisagreement` matching exactly `kind: "dom_snippet"`
  — if Cluster A widens it (e.g., adds `screenshot`), the seed
  becomes ambiguous. Mitigations: regression test in CI; Task 1's
  grep is mandatory; predicate locked at `handler.ts:25-27` and
  tested in PRP-B's in-process-gate boot.
