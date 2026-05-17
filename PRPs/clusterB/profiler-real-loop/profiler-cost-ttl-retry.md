name: "Profiler — PRP-D: cost trip-wire + TTL heuristic + retry policy (TDD)"
description: |

  Fourth of five PRPs implementing `features/clusterB/profiler-real-loop.md`.
  Lands three pure-logic siblings PRP-C's `runProfiler` deferred —
  `costTripwire`, `ttlPolicy`, `retry` — plus a `config.ts` env-var
  module, and threads them into the existing loop.

  **Prereqs**: PRP-A (`profiler-contracts.md` — `DegradationHint`,
  `NackReason`, `ProfileJob` types); PRP-C (`profiler-core-loop.md` —
  `runProfiler.ts` + `commit.ts`, the files this PRP EDITS). Block on
  PRP-C merge before starting Tasks 8–10.

  **Follow-up**: PRP-E (integration test + smoke) consumes the wired
  trip-wire + verifies `LlmClient.usage` populates against real Gemini.

  ## TDD discipline

  **Red → Green → Refactor.** Write the test first; run it; confirm
  it fails for the *expected reason* (`ERR_MODULE_NOT_FOUND` /
  `TS2307` / mismatched assertion on a not-yet-wired branch). A test
  that fails for the wrong reason (typo, fake-timer misconfig) is not
  a real red. Each helper is **pure logic on stdlib only** — no mock
  layer except `vi.useFakeTimers`. Commit at green; never at red
  unless the message reads `WIP — red`.

  ## Why this PRP exists separately

  Each helper has a distinct test rig: TTL is a `test.each` table,
  cost trip-wire is a stateful fake-timer matrix, retry is a
  stateless classifier + arithmetic. Splitting keeps PRP-C's loop
  spec focused on orchestration, not the inner math. **PRP-C
  hardcoded `ttl: 21600` and `nack({ kind: "transient" })` as
  placeholders**; this PRP swaps them. The cost trip-wire IS the
  Gemini-Pro spend guardrail (`features/clusterB/profiler-real-loop.md:188-190`).

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A. Warm path; helpers are pure; foundation
    ESLint boundary (`PRPs/foundation-ad-verification.md:157-159`)
    blocks `packages/gate/**` from importing.
  - **Plug-and-play** — Pure functions over `@scout/shared` types.
    No singletons, no module-state. Portable as-is.
  - **Sponsor tech** — Gemini (heavy): trip-wire is Pro-spend
    protection (feature line 188). Lobster Trap (indirect): trip-wire
    toggles `degradationHint` which Cluster C verifiers read from
    `VerifierContext`; LT-proxied calls become fewer, not more.

  ## CLAUDE.md rules

  No new runtime deps. TypeScript strict, NodeNext, ES2022, ESM-only.
  Files ≤ ~300 lines; tests colocated as `*.test.ts`. `DegradationHint`
  + `NackReason` come from PRP-A's `@scout/shared` — never redefined.

  ## Decisions (locked here)

  | # | Question | Locked answer | Why |
  |---|---|---|---|
  | D1 | Sliding-window structure | Queue of `{ ts, cost }[]`; on each query, evict `ts < now - COST_WINDOW_MS` and sum the rest. | Sliding, not tumbling. O(N) eviction; N ≤ ~hundreds at demo throughput. |
  | D2 | Cost proxy | `verdict.usage?.total_tokens ?? verdict.modelLatencyMs`. Tested on BOTH paths. | Feature Open Question line 226. (B) when Gemini compat layer populates usage; (A) as fallback so the trip-wire works either way. |
  | D3 | Floor semantic | `chooseDegradation(window, jobHint)` returns `max(jobHint, windowHint)`, enum ordered `none < drop_video < collapse_text_image`. | Feature line 103. Window upgrades severity in-flight; never downgrades below the enqueuer's request. |
  | D4 | Backoff curve | `min(2^attempt * BASE_MS, CAP_MS)`. `attempt=1 → 1000ms` (2¹·500). | Feature line 107. First transient retry waits 1s, gives upstream room to recover. |
  | D5 | Backoff defaults | `BASE=500`, `CAP=60_000`, `MAX_ATTEMPTS=5`. | Sum across 5 caps ≤ 5 min — well under demo patience. |
  | D6 | `classifyError` matrix | `HarnessException`: `TIMEOUT` / `UPSTREAM_DOWN` / `NAVIGATION_FAILED` → transient. `BLOCKED` → transient @attempt 1, poison @attempt ≥ 2. `CONSENT_WALL_UNRESOLVED` → poison (always). `AbortError` → transient (`detail: "shutdown"` if `shutdownDriven`, else `"abort"`). `ZodError` on emitted `PageProfile` → poison (code bug, not retryable). Plain `Error` → transient (default to retry). `attempt ≥ MAX_ATTEMPTS` → poison regardless. | `BLOCKED` sometimes resolves on retry-1 with a fresh session; rarely on retry-2. `CONSENT_WALL_UNRESOLVED` is structural — retry never helps. |
  | D7 | Sentinel `verifier_blackout` threshold | Emit sentinel commit when `arbiter.humanReviewRecommended && verifierFailedCount >= 2`. ADDITION to `consensusCategories`, not replacement; confidence `1.0`. | Feature line 253 is ambiguous; pin here. 2-of-3 failing means the page has so little signal a permissive policy must NOT ALLOW it; 1-of-3 still leaves enough for arbiter consensus. |
  | D8 | DLQ audit ordering | `auditStore.put({ kind: "profile_job_dlq" })` BEFORE `queue.nack({ kind: "poison" })`. | Race: consumer reclaim picks up the nack before the audit row commits → DLQ row never lands. Write-then-nack, always. |
  | D9 | `logger` shape | Match PRP-C. If PRP-C wired a `Logger` interface, use it; if PRP-C punted to `console.*`, helpers accept `logger: Pick<Console, "info">` and call sites inject `deps.logger ?? console`. | Don't re-pick the abstraction here. |
  | D10 | `process.env.*` access site | Single `config.ts`. Mirrors `packages/harness/src/config.ts`. | Foundation rule `PRPs/foundation-ad-verification.md:301`. |
  | D11 | Sentinel rule coordination | Filed as follow-up referencing `features/clusterA/policy-match-evaluation.md:38` (the `permissive-baseline.json` fixture). This PRP commits the CATEGORY; the policy-fixtures PRP adds the matching deny RULE. | Cross-cluster; profiler does not edit `packages/policy/fixtures/**`. |
  | D12 | UGC host regex scope | `/(reddit|twitter|x\.com|tiktok|youtube\.com\/shorts)/i` matched against `URL.host + URL.pathname`. | Feature line 96. Path-aware for `youtube.com/shorts`; negative test pins `example.com/reddit` does NOT match. |

  ## All Needed Context

  ```yaml
  - file: features/clusterB/profiler-real-loop.md
    section: "TTL (93-97); cost trip-wire (99-104); retry policy (107);
      TTL test (128); transition matrix (125); degradationHint floor
      (126-127); retry/poison tests (122); sentinel verifier_blackout
      (253); cost proxy Open Q (226); fail-loud gotcha (265); domText
      log warning (248)."
    why: Source spec. Every helper maps to one block.

  - file: PRPs/clusterB/profiler-real-loop/profiler-contracts.md
    why: PRP-A. DegradationHint / NackReason / ProfileJob types.

  - file: PRPs/clusterB/profiler-real-loop/profiler-core-loop.md
    why: PRP-C. EDITS runProfiler.ts loop + commit.ts TTL site.

  - file: PRPs/clusterB/harness-browser-helpers.md
    why: Pure-helper PRP structural precedent (TDD task list, decisions,
      target contracts inline, validation sweep). Copy shape, not content.

  - file: packages/harness/src/config.ts
    why: Env-var module precedent — single process.env access, typed
      exported config, name-only error hints.

  - file: packages/harness/src/__tests__/config.test.ts
    why: vi.stubEnv + vi.unstubAllEnvs pattern for env-var defaults.

  - file: packages/shared/src/interfaces/harness.ts
    section: "HarnessError enum (5 codes); HarnessException class"
    why: classifyError switches on err.code; pin the 5 codes.

  - file: features/clusterA/policy-match-evaluation.md
    section: "lines 32 (ambiguousAction), 38 (permissive-baseline)"
    why: Coordination follow-up — sentinel deny rule lives there;
      this PRP files the follow-up but DOES NOT edit the fixture.

  - url: https://vitest.dev/api/vi.html#vi-usefaketimers
    why: Transition matrix uses fake timers; gotcha line 267 says fake
      timers + ioredis don't mix — fine here (pure in-memory).

  - url: https://vitest.dev/api/#test-each
    why: TTL heuristic table.
  ```

  ## Files to create

  - `packages/profiler/src/costTripwire.ts` + `__tests__/costTripwire.test.ts`
  - `packages/profiler/src/ttlPolicy.ts` + `__tests__/ttlPolicy.test.ts`
  - `packages/profiler/src/retry.ts` + `__tests__/retry.test.ts`
  - `packages/profiler/src/config.ts` + `__tests__/config.test.ts`

  ## Files to modify

  - **`packages/profiler/src/commit.ts`** (created in PRP-C) — swap the
    hardcoded TTL for `computeTtl(capture)`. One import + one call-site.
  - **`packages/profiler/src/runProfiler.ts`** (created in PRP-C) —
    four threads:
    1. Construct `SpendWindow` once at the `createProfiler` boundary.
    2. Before each dispatch: derived = `chooseDegradation(window,
       job.degradationHint, now, logger)`; thread into `VerifierContext`.
       If derived === `"drop_video"`: skip `video.verify`. If derived ===
       `"collapse_text_image"` AND `deps.verifiers.combined` absent: the
       worker throws, classified as poison, DLQ row + nack (feature
       line 265 fail-loud at job-time — the missing-combined guard is
       LAZY, not at construction; deps map is open by PRP-A's interface).
    3. Replace `nack({ kind: "transient" })` placeholder with
       `nack(classifyError(err, { attempt: job.attempt, shutdownDriven }))`.
       For poison nacks, write DLQ audit row FIRST (D8).
    4. After arbiter, if `humanReviewRecommended && failedCount >= 2`,
       append `{ label: "verifier_blackout", confidence: 1.0 }` to
       `consensusCategories` BEFORE commit (D7).
  - `packages/profiler/package.json` — NO change (zero new deps).

  ## Target contracts (pseudocode)

  **`costTripwire.ts`** — exports:

  ```ts
  interface SpendSample { ts: number; cost: number; }
  interface SpendWindow { samples: SpendSample[]; lastHint: DegradationHint; }

  createSpendWindow(): SpendWindow                              // { [], "none" }
  costOf(verdict): number                                       // D2: usage.total_tokens ?? modelLatencyMs
  recordSpend(window, now, cost): void                          // push { ts: now, cost }
  chooseDegradation(window, jobHint, now, logger): DegradationHint
    // 1. Evict samples where ts < now - costWindowMs (D1 sliding).
    // 2. total = sum(samples.cost).
    // 3. windowHint = total > hard ? "collapse_text_image"
    //               : total > soft ? "drop_video" : "none".
    // 4. next = maxHint(jobHint, windowHint) per ORDER {none:0, drop_video:1,
    //    collapse_text_image:2} (D3).
    // 5. if next !== window.lastHint: logger.info({event, from, to}); update.
    // 6. return next.
  ```

  **`ttlPolicy.ts`** — exports `computeTtl(capture: PageCapture): number`:

  ```ts
  // Returns SECONDS (PageProfile.ttl convention).
  const og = capture.metadata?.ogType;
  if (og === "article" || og === "news" || og?.startsWith("video."))
    return cfg.ttlNewsSeconds;
  try { url = new URL(capture.url); } catch { return cfg.ttlDefaultSeconds; }
  // D12: matched against host + pathname (path-aware for youtube.com/shorts).
  if (/(reddit|twitter|x\.com|tiktok|youtube\.com\/shorts)/i.test(url.host + url.pathname))
    return cfg.ttlUgcSeconds;
  return cfg.ttlDefaultSeconds;
  ```

  **`retry.ts`** — exports `classifyError(err, ctx)` + `computeRetryAt(attempt, now?)`:

  ```ts
  classifyError(err, { attempt, shutdownDriven }) → NackReason:
    if (attempt >= cfg.maxAttempts) return poison("max_attempts_exhausted");
    if (err instanceof HarnessException) {
      if (err.code === "CONSENT_WALL_UNRESOLVED") return poison("consent_wall_unresolved");
      if (err.code === "BLOCKED" && attempt >= 2) return poison("blocked_after_retry");
      return transient(err.code.toLowerCase(), computeRetryAt(attempt));
    }
    if (err.name === "AbortError")
      return transient(shutdownDriven ? "shutdown" : "abort", computeRetryAt(attempt));
    if (err.name === "ZodError") return poison("profile_schema_invalid");
    return transient("unknown", computeRetryAt(attempt));

  computeRetryAt(attempt, now = Date.now()):
    // D4 + D5.
    waitMs = min(2 ** attempt * cfg.backoffBaseMs, cfg.backoffCapMs);
    return new Date(now + waitMs).toISOString();
  ```

  **`config.ts`** — single `process.env.*` site (D10). Exports
  `profilerConfig(): ProfilerConfig` reading via `intEnv(name, fallback)`
  helper (fallback on unset / non-numeric / non-positive). Keys + defaults:
  `PROFILER_COST_WINDOW_MS=60000`, `_SOFT=8000`, `_HARD=16000`,
  `PROFILER_TTL_NEWS_SECONDS=1800`, `_UGC=600`, `_DEFAULT=21600`,
  `PROFILER_BACKOFF_BASE_MS=500`, `_CAP=60000`, `PROFILER_MAX_ATTEMPTS=5`.
  Mirrors `packages/harness/src/config.ts:1-29` shape; returns defaults
  silently (no throw — config is non-required; only the harness's
  `BROWSER_USE_API_KEY` is required and that lives elsewhere).

  ## Task order (TDD; commit-sized)

  1. **Red→Green: `config.ts` env defaults.** Mirror harness `config.test.ts`:
     `vi.stubEnv` each key; assert defaults when unset, custom values when
     set, fallback-to-default on non-numeric / negative.
  2. **Red→Green: `ttlPolicy.ts` heuristic.** `test.each` rows (~10):
     `article@example.com → 1800`; `news@cnn.com → 1800`; `video.movie →
     1800`; `video.episode → 1800` (startsWith); `null@reddit.com → 600`;
     `null@x.com → 600`; `null@youtube.com/shorts/abc → 600`;
     `null@example.com/reddit → 21600` (negative; D12); `null@example.com
     → 21600`; `null@news.example.com → 21600` (not UGC, not news og).
  3. **Red→Green: `computeRetryAt` curve.** `vi.useFakeTimers`,
     `setSystemTime(0)`: attempt 1 → 1000ms; 2 → 2000; 3 → 4000; 4 →
     8000; 8 → 60000 (capped); 20 → 60000 (still capped).
  4. **Red→Green: `classifyError` matrix.** Rows: `HarnessException(TIMEOUT)`
     @1 → transient/`"timeout"`; `(UPSTREAM_DOWN)` @1 → transient;
     `(NAVIGATION_FAILED)` @2 → transient; `(BLOCKED)` @1 → transient;
     `(BLOCKED)` @2 → poison/`"blocked_after_retry"`;
     `(CONSENT_WALL_UNRESOLVED)` @1 → poison; plain `Error("network")` @1
     → transient; `AbortError` + `shutdownDriven: true` → transient/`"shutdown"`;
     `AbortError` (no flag) → transient/`"abort"`; `ZodError` → poison;
     any err @attempt 5 → poison/`"max_attempts_exhausted"`. Transient
     rows assert `retryAt` is valid ISO8601.
  5. **Red→Green: `chooseDegradation` floor.** Empty window + `jobHint:
     "drop_video"` → returns `"drop_video"`. Pins D3.
  6. **Red→Green: cost-tripwire transitions.** `vi.useFakeTimers`,
     soft=8000, hard=16000:
     - 7 samples × 1000 → hint `"none"` (total 7000 ≤ soft).
     - 8th sample → total 8000, strict `>` → still `"none"`.
     - 9th sample → 9000 > soft → `"drop_video"`. Assert `logger.info`
       fired once with `{ event: "cost_tripwire_change", from: "none",
       to: "drop_video" }`.
     - More samples → total > 16000 → `"collapse_text_image"`. Second log.
     - `advanceTimersByTime(60_001)` → eviction → `"none"`. Third log.
  7. **Red→Green: cost proxy fallback.** `costOf` two rows:
     `{ usage: { total_tokens: 5000 }, modelLatencyMs: 100 }` → 5000;
     `{ usage: null, modelLatencyMs: 100 }` → 100. Both paths tested per D2.
  8. **Red→Green: EDIT `commit.ts` for `computeTtl`.** Red: edit PRP-C's
     `commit.test.ts` row for a news og-type capture to expect 1800
     (currently 21600). Green: replace hardcoded TTL line with
     `ttl: computeTtl(capture)`. PRP-C's default-case tests still pass
     (default is still 21600).
  9. **Red→Green: EDIT `runProfiler.ts` to thread `degradationHint` +
     `classifyError` + DLQ-then-nack.** Three new tests in
     `runProfiler.test.ts`:
     - **Floor** — `job.degradationHint: "drop_video"`, window empty;
       assert `verifiers.video.verify` NOT called.
     - **Missing combined fails loud** — `degradationHint:
       "collapse_text_image"` job, deps without `verifiers.combined`:
       worker throws BEFORE `harness.capturePage`; error classified
       poison; DLQ audit row written; nack-poison fires.
     - **`classifyError` wired + audit-before-nack** — `harness.capturePage`
       throws `HarnessException("BLOCKED", "x")`. Attempt 1: assert
       `queue.nack({ kind: "transient", ... })`. Attempt 2: same throw
       → assert `auditStore.put({ kind: "profile_job_dlq", ... })`
       called BEFORE `queue.nack({ kind: "poison", ... })` via
       `mock.invocationCallOrder` (D8).
     Green: wire the helpers into the catch block + dispatch pre-check.
  10. **Red→Green: sentinel `verifier_blackout` commit (D7).** Red:
      2 of 3 verifiers throw, 1 succeeds; arbiter stub returns
      `humanReviewRecommended: true, consensusCategories: [{ label:
      "real", confidence: 0.6 }]`. Assert `profileStore.put` profile's
      `categories` contains BOTH `"real"` AND `"verifier_blackout"`
      (confidence 1.0) — addition, not replacement. Green: append the
      sentinel in `runProfiler.ts` after arbiter.
  11. **Red→Green: DLQ row content + no `domText` (security).** Trigger
      poison nack (attempt 5 + TIMEOUT). Assert audit row has `kind,
      advertiserId, jobId, attempt: 5, reason: "max_attempts_exhausted"`;
      assert it does **NOT** contain `capture.domText` (feature line 248).
  12. **Validation sweep.**
      ```bash
      pnpm --filter @scout/profiler test
      pnpm -r exec tsc --noEmit
      pnpm -r exec eslint . --fix
      pnpm -r build
      grep -rn "process\\.env" packages/profiler/src   # only config.ts
      grep -rn "openai\\|@google/genai" packages/profiler   # 0 hits
      ```

  ## Validation gates

  - `pnpm --filter @scout/profiler test` → all green.
  - `pnpm -r exec tsc --noEmit` → 0 errors.
  - `pnpm -r build` → clean.
  - `process.env` appears only in `config.ts`.
  - No `openai` / `@google/genai` imports anywhere under
    `packages/profiler` (foundation ESLint rule preserved).

  ## Security guardrails

  - **`config.ts` is the single `process.env.*` access site** (D10).
    Validation grep enforces.
  - **Tenant scoping unchanged.** `ProfileJob.advertiserId` flows
    through to the DLQ audit row; PRP-E owns the cross-tenant
    disjointness test. This PRP threads the value, never strips it.
  - **DLQ audit rows MUST NOT include `capture.domText`.** Feature
    line 248 — up to 256 KiB of arbitrary page content. The DLQ row
    is structured: `{ kind, advertiserId, jobId, attempt, reason }`.
    Tested in Task 11.
  - **Transition log never dumps window contents.** Emits `{ event,
    from, to }` only; per-tenant spend patterns stay out of logs.
  - **No raw env values in error messages.** `config.ts` returns
    defaults silently on parse failure (does not throw); a future
    "required env" addition must mirror `harnessConfig`'s name-only
    hint pattern.

  ## Out of scope — file as follow-ups

  - **Sentinel `verifier_blackout` deny rule in `permissive-baseline.json`**
    (`features/clusterA/policy-match-evaluation.md:38`). Coordinated
    per D11; profiler does not edit policy fixtures. Without the deny
    rule, a permissive advertiser with `ambiguousAction: ALLOW` still
    ALLOWs a verifier-blackout page — the sentinel CATEGORY is in
    place but nothing fires on it.
  - **Redis-backed sliding window.** Single-process v1; multi-process
    deploys re-window per process. Filed alongside the Redis
    `processedJobIds` move (feature line 257).
  - **Per-tenant cost windows.** v1 shares one window; a quota-burning
    advertiser drops video for everyone. File under per-tenant queue
    isolation (feature line 278).
  - **Cost proxy calibration.** Defaults (soft 8000, hard 16000) are
    pre-demo placeholders. The demo-bidstream-seeding PRP
    (`FEATURE-TODO.md:79-82`) tunes against measured spend.
  - **`LlmClient.usage` shape verification.** PRP-E's smoke script
    logs `usage.total_tokens` on real Gemini compat-layer; if null,
    cost proxy falls back to (A) per D2.
  - **`HarnessException(BLOCKED)` proxy rotation.** D6 locks "one
    retry then poison." Future: rotate proxy country on retry-1.
    Filed against the harness PRP.

  ## Anti-patterns

  - **Don't reset the cost window on each job.** D1 — sliding, not
    tumbling. Resetting masks a sustained burst.
  - **Don't poison on first transient failure.** D6 — TIMEOUT /
    UPSTREAM_DOWN / NAVIGATION_FAILED ALL retry up to MAX_ATTEMPTS.
    Single-failure poison turns a flaky upstream into permanent
    DENY-on-every-bid (the exact failure mode feature line 107 names).
  - **Don't write the DLQ audit row AFTER `nack({ kind: "poison" })`.**
    D8 — race with consumer reclaim.
  - **Don't accept `degradationHint` downgrades.** D3. Window UPGRADES
    in-flight; enqueuer's request is the floor. Naive `windowHint`
    swap loses the floor — demo bidstream-seeding can no longer force
    `"drop_video"` on its fixtures.
  - **Don't widen `NackReason.detail` to user-visible PII.** Detail
    strings are logged + audited — use enum-like short strings
    (`"timeout"`, `"blocked_after_retry"`); never include `job.pageUrl`
    or `capture.domText` excerpts.
  - **Don't add a runtime dep.** Sliding window is `.shift()` on an
    array; backoff is `Math.min` + `2 **`; TTL is one regex.
  - **Don't put `process.env.*` in helpers.** D10. Validation grep
    catches it.
  - **Don't fire the trip-wire log on every job.** Only on transitions
    (`next !== window.lastHint`). Logging every dispatch floods the
    dashboard.

  ## Confidence: 8 / 10

  Pure-logic PRP with three independent helpers and two ~5-line edits
  to PRP-C's files. The one risk: the sentinel-`verifier_blackout`
  threshold (D7) is a judgment call the feature file punted on. This
  PRP locks "2-of-3 failed AND arbiter recommends HUMAN_REVIEW," but
  if Cluster C's real arbiter derives `humanReviewRecommended`
  differently (e.g., for low-confidence agreement, not for missing
  data), the sentinel could fire on pages that aren't actually
  verifier-blackouts. Mitigation: the follow-up policy-fixture rule
  (D11) is the real failsafe — without the deny rule, the sentinel is
  a no-op category. Land the follow-up before stage.
