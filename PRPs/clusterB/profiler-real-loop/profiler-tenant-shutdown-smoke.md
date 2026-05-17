name: "Profiler — PRP-E: tenant URIs + full audit row + shutdown + integration + smoke (TDD)"
description: |

  Fifth and **final** PRP for `features/clusterB/profiler-real-loop.md`. Closes the
  polish items PRPs C+D deferred and ships the end-to-end exercises:

  - **Tenant-scoped evidence URI rewrite** in `commit.ts` (feature lines 89, 129, 247).
  - **Full audit-row schema** in `commit.ts` (feature line 109; trace-ID order gotcha 263).
  - **Graceful shutdown polish** in `runProfiler.ts` — abort + grace + nack-on-timeout;
    no `ack` on shutdown (feature lines 111, 133).
  - **Integration test** — 5 jobs against PRP-B's in-memory rig (feature line 136).
  - **Smoke script** against real Cloud SDK + Lobster Trap + Gemini (feature line 138).
  - **Coordination follow-ups** — `verifier_blackout` policy fixture (line 253) and
    Redis `processedJobIds` upgrade-path (line 257).

  **Prereqs (all merged):**

  - PRP-A `profiler-contracts.md` — `AgentVerdict`, `ArbiterDecision`, `ProfileJob`, `Verifier`, `Arbiter`, `ProfileQueue`.
  - PRP-B `profiler-in-memory-queue.md` — `InMemoryProfileQueue` (test rig).
  - PRP-C `profiler-core-loop.md` — `runProfiler.ts`, `fanout.ts`, `commit.ts` skeleton + minimal audit row + `processedJobIds` LRU. **This PRP EDITS** `commit.ts` and `runProfiler.ts`.
  - PRP-D `profiler-cost-ttl-retry.md` — `retry.ts` DLQ audit row writer. The full audit-row schema landed here aligns with PRP-D's DLQ rows.

  ## TDD discipline

  **Red → Green → Refactor.** Test first; *correct-reason* red (`ERR_MODULE_NOT_FOUND`,
  `TS2322`, or an assertion miss — never a typo). Minimum impl. Tidy. Commit at green.
  Edits to PRP-C/D files MUST keep their tests green; run them after every change.
  Pure helper first (Task 1), then call-site (Task 2), then runtime (audit, shutdown),
  then end-to-end (integration, smoke). The latter two run LAST — they're the cross-PRP
  drift detectors.

  ## Why this PRP exists separately

  - **URI rewrite** is a tenancy-isolation invariant; cross-advertiser disjointness
    must be an arithmetic property, not a runtime accident (feature line 247).
  - **Audit row** is the Veea-Award demo claim in executable form ("every verifier→LLM
    call routes through Lobster Trap"); the trace-ID-chain test is the demo-moment
    assertion (feature line 134).
  - **Graceful shutdown** is the at-least-once delivery invariant — `ack`-on-abort
    silently drops jobs.
  - **Integration + smoke** consume the full pipeline; they catch cross-PRP drift.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A; warm path. Smoke prints `totalMs` for observability,
    not enforcement.
  - **Pre-bid** — Boundary unchanged; integration test asserts `ProfileStore.put`
    before `ProfileQueue.ack`.
  - **Plug-and-play** — `rewriteEvidenceUri` is a pure helper in `@scout/profiler`;
    harness still emits namespaceless URIs per `harness-capture-page.md:135-140, 150`.
  - **Sponsor tech (BOTH, heavy)** — Veea demo moment IS Task 3 (audit row trace-ID
    chain); smoke (Task 7) runs the chain end-to-end against real Lobster Trap.
    Gemini Pro warm-path story is the smoke's `fanoutMs` line.

  ## CLAUDE.md rules that bite

  - 300-line cap on every file: new tests + smoke each ≤ 200; `commit.ts` edits
    additive — extract if it crosses 250.
  - **Zero new runtime deps.** `tsx` already a workspace devDep.
  - § Update protocol — append profiler bullet to § Stack on merge (Task 9).

  ## Decisions (locked here)

  | # | Question | Locked answer |
  |---|---|---|
  | D1 | Evidence URI rewrite format | **`evidence/{advertiserId}/{contentHash}/{idx}.{ext}`**. Input `file:///tmp/scout-evidence/{contentHash}/{idx}.{ext}` (or any harness-emitted shape ending in `.../{contentHash}/{idx}.{ext}`) → output above. Pure string substitution; extension preserved. |
  | D2 | Rewrite idempotency / conflict | Pass through unchanged if input already starts with `evidence/{advertiserId}/` (same advertiserId). **Throw** `Error("evidence URI namespace conflict")` if a different advertiserId prefix detected — that's a cross-tenant assignment bug, fail loud. |
  | D3 | Audit-row trace-ID order | **Fixed verifier-kind enum order**: `["text", "image", "video", "arbiter"]`. Skip `video` slot only when video verifier was NOT invoked. Arbiter trace is ALWAYS last (gotcha 263). |
  | D4 | Audit row on null trace ID | Record `null` at expected index; increment `lobstertrap_trace_missing_total`; profile STILL commits (line 132 — brand-safety per-bid is gate's job; profile commit per-page is profiler's). |
  | D5 | `decisionPath` matrix | Happy: `["captured","fanout","arbitrated","committed"]`. Fanout fail: `["captured","fanout_failed"]`. Capture throw: `["capture_failed"]`. Commit throw: `[...,"commit_failed"]`. Poison: `["dlq"]`. |
  | D6 | `elapsedMs` | Wall-clock from `for-await-of` yield to ack/nack; uses `clock?: () => number` (default `Date.now`) injected for determinism. |
  | D7 | `PROFILER_SHUTDOWN_GRACE_MS` default | **30000** (30 s). |
  | D8 | `stop()` resolution semantic | **Resolves when ALL in-flight jobs settle** (ack or nack), capped at `grace + PROFILER_SHUTDOWN_HARD_KILL_MS` (default 5000 = 35 s hard cap). After grace, in-flight jobs nack-transient with `detail: "shutdown"`; impl awaits the nacks then resolves. **No `ack` on shutdown — ever.** Test pins both branches: settles-before-grace acks normally; still-in-flight-at-grace nacks-transient. |
  | D9 | `processedJobIds` LRU on stop/start | **Preserved** across stop+start in the same process; cleared only on process exit. Stop+start re-deliveries short-circuit. |
  | D10 | Smoke script exit codes | `0` on full happy path; **nonzero on any failed step** including `lobstertrapTraceId: null` on a non-degraded run (sponsor-tech wire breakage). |
  | D11 | Smoke `trace_count` expected | **4** on happy non-degraded; **3** on no-video URL. Document both in header. |
  | D12 | Tenancy isolation in queue logs | Log `{ jobId, attempt, advertiserId }` and `{ jobId, pageUrl }` as **separate** structured events — never one event cross-referencing both (line 251). Dashboard tenant-filters on read. |
  | D13 | Audit write on commit failure | Best-effort: `auditStore.put` failure logs `audit_dropped` and proceeds. PRP-C pinned this; restated so this PRP's edit doesn't regress it. |

  ## All Needed Context

  ```yaml
  - file: features/clusterB/profiler-real-loop.md
    section: "89, 109, 111, 129, 132, 133, 136-138, 247, 251-253, 257, 263"
    why: Source spec; this PRP's owned lines.
  - file: PRPs/clusterB/profiler-real-loop/profiler-core-loop.md
    why: PRP-C. Owns commit.ts + runProfiler.ts. Edits must keep its tests green.
  - file: PRPs/clusterB/profiler-real-loop/profiler-cost-ttl-retry.md
    why: PRP-D. Owns retry.ts (DLQ audit writer). Full row schema aligns with DLQ rows.
  - file: PRPs/clusterB/profiler-real-loop/profiler-contracts.md
    why: PRP-A. AgentVerdict.lobstertrapTraceId, ArbiterDecision.lobstertrapTraceId.
  - file: PRPs/clusterB/profiler-real-loop/profiler-in-memory-queue.md
    why: PRP-B. Integration test rig; getDLQ() shape.
  - file: PRPs/clusterB/harness-two-pass-and-docs.md
    why: Structural precedent for integration+smoke+docs PRP.
  - file: packages/harness/scripts/smoke-capture.ts
    why: Smoke style — hardcoded URLs in source, structured JSON per phase,
      nonzero exit on error, never log full PageCapture.
  - file: features/clusterB/harness-capture-page.md
    section: "135-140 (namespaceless URIs); 150 (no advertiserId in CaptureOptions);
      152 (no cookie/session across jobs)"
    why: Tenancy boundary; profiler is the rewrite seam.
  - file: features/clusterA/policy-match-evaluation.md
    section: "32 (ambiguousAction); 38 (permissive-baseline)"
    why: Coordination follow-up — verifier_blackout sentinel.
  - file: CLAUDE.md
    section: "§ Stack; § Update protocol; 300-line file cap"
    why: Append profiler bullet on merge (Task 9).
  ```

  ## Files to create / modify

  **Create:**

  - `packages/profiler/src/__tests__/rewriteEvidenceUri.test.ts`
  - `packages/profiler/src/__tests__/runProfiler.shutdown.test.ts`
  - `packages/profiler/src/__tests__/runProfiler.integration.test.ts`
  - `packages/profiler/scripts/smoke-profiler.ts`

  **Modify (EDIT — PRPs C+D wrote these; do NOT introduce parallel call sites):**

  - `packages/profiler/src/commit.ts` — **EDIT**: add pure `rewriteEvidenceUri`
    helper; rewrite `evidenceRefs[]` on commit; replace PRP-C's minimal audit row
    with the full structured row (Tasks 1, 2, 3, 5).
  - `packages/profiler/src/runProfiler.ts` — **EDIT**: shutdown grace + nack-on-timeout;
    `stop()` Promise resolves per D8 (Task 4).
  - `packages/profiler/package.json` — **EDIT**: add `"smoke": "tsx scripts/smoke-profiler.ts"`. No new runtime deps.
  - `CLAUDE.md` — **EDIT**: append profiler stack bullet (Task 9).

  **Do NOT create:** a new `auditRow.ts` factor-out (inline in `commit.ts` + `retry.ts`;
  v2 nit); a separate `shutdown.ts` (state lives in `runProfiler.ts`).

  ## Target contracts

  ### `rewriteEvidenceUri` (pure helper in `commit.ts`)

  ```ts
  /**
   * Tenant-scope an evidence URI emitted by the harness.
   * Input  : "file:///tmp/scout-evidence/{contentHash}/{idx}.{ext}"
   * Output : "evidence/{advertiserId}/{contentHash}/{idx}.{ext}"
   * Idempotent on same-advertiser already-namespaced input.
   * Throws on different-advertiser already-namespaced input (D2).
   */
  export function rewriteEvidenceUri(
    uri: string,
    advertiserId: string,
    contentHash: string,
  ): string;
  ```

  ### Full audit row (inline in `commit.ts` + `retry.ts`)

  ```ts
  interface ProfileAuditRow {
    advertiserId: string;
    jobId: string;
    profileId: string | null; // null on capture_failed / fanout_failed / dlq
    lobstertrapTraceIds: (string | null)[]; // fixed enum order; arbiter last (D3)
    decisionPath: DecisionPath;             // D5
    elapsedMs: number;                      // wall-clock dispatch → ack/nack (D6)
  }

  type DecisionPath =
    | ["captured", "fanout", "arbitrated", "committed"]
    | ["captured", "fanout", "arbitrated", "commit_failed"]
    | ["captured", "fanout_failed"]
    | ["capture_failed"]
    | ["dlq"];
  ```

  ### Smoke script CLI

  - `pnpm --filter @scout/profiler run smoke` (NO CLI args; URL hardcoded).
  - Env: `GEMINI_API_KEY`, `LOBSTERTRAP_PROXY_URL`, `BROWSER_USE_API_KEY` required.
  - Output: `{"event":"summary","profileId":...,"captureMs":...,"fanoutMs":...,"arbiterMs":...,"commitMs":...,"totalMs":...,"trace_count":4}`.
  - Exit `0` on success; non-zero on any error or `trace_count` mismatch (D10).

  ## Task order (TDD; commit-sized)

  ### Task 1 — Red→Green: `rewriteEvidenceUri` pure helper

  **Red.** `rewriteEvidenceUri.test.ts`:
  - **Happy** — `("file:///tmp/scout-evidence/abc123/0.png","advertiser-A","abc123")` → `"evidence/advertiser-A/abc123/0.png"`. `.jpg`/`.webp`/no-ext all preserved.
  - **Edge — cross-advertiser disjointness** — same `contentHash="abc123"` with `"advertiser-A"` vs `"advertiser-B"` produces disjoint URIs. Regression = cross-tenant disclosure bug.
  - **Edge — idempotent same-advertiser** — input already `evidence/advertiser-A/...` returns unchanged.
  - **Failure — namespace conflict** — input `evidence/advertiser-B/...` with `advertiserId="advertiser-A"` throws `/namespace conflict/`.
  - **Failure** — empty `advertiserId` rejected.

  **Green.** Add to `commit.ts`, export. ≤ 30 lines.

  ### Task 2 — Red→Green: `commit.ts` integration of URI rewrite

  **Red.** Extend PRP-C's `commit.test.ts`:
  - **Happy** — capture with `screenshots: [{ kind: "screenshot", uri: "file:///tmp/scout-evidence/abc123/0.png" }]` + `advertiserId: "advertiser-A"` commits profile with `evidenceRefs[0].uri === "evidence/advertiser-A/abc123/0.png"`.
  - **Happy** — multiple screenshots + video samples + dom snippets all rewritten; order preserved.
  - **Edge — cross-advertiser commits** — same capture committed for two advertisers yields disjoint `evidenceRefs[].uri`.

  **Green.** In `commit.ts`'s mapping, route each evidence URI through `rewriteEvidenceUri`. Keep the mapper pure (no I/O inside).

  ### Task 3 — Red→Green: full audit-row schema

  **Red.** Extend `commit.test.ts`:
  - **Happy non-degraded** — 3 verifiers + arbiter all non-null traces; audit row's `lobstertrapTraceIds` has 4 entries in order `[text, image, video, arbiter]`; `decisionPath === ["captured","fanout","arbitrated","committed"]`; `profileId` set; `elapsedMs > 0`.
  - **Happy no-video** — `videoSamples: []`; video verifier not invoked; trace array is 3 entries `[text, image, arbiter]`; arbiter ALWAYS last.
  - **Edge — verifier null trace** — `image` returns `lobstertrapTraceId: null`; profile commits; row records `null` at index 1; injected metrics spy sees `lobstertrap_trace_missing_total += 1`.
  - **Edge — arbiter null** — same at last index.
  - **Edge — all nulls** — degenerate; commits; counter += 4 (D4).

  **Green.** In `commit.ts`, build the row inline before `auditStore.put`. Use `VerifierKindSchema.options` for iteration order; arbiter appended last; skip video slot iff `capture.videoSamples.length === 0`. Increment injected metrics counter per null. Don't touch the URI rewrite path.

  ### Task 4 — Red→Green: graceful shutdown polish

  **Red.** `runProfiler.shutdown.test.ts`:
  - **Happy — shutdown after natural ack** — enqueue 1; await commit; `stop()` resolves; no DLQ; no nack calls observed.
  - **Edge — settles before grace** — enqueue 1; block verifiers on a controlled promise; call `stop()`; release within grace; job acks; `stop()` resolves AFTER ack; `ack` called, `nack` not.
  - **Edge — exceeds grace** — same setup; never release; advance fake timers past `PROFILER_SHUTDOWN_GRACE_MS`; `nack({ kind: "transient", detail: "shutdown" })` called; `ack` NEVER called; `stop()` resolves shortly after the nack.
  - **Edge — abort signal propagation** — verifier mock observes `ctx.abortSignal.aborted === true` within 10 ms of `stop()` (gotcha 258).
  - **Edge — LRU preserved** — process job A; `stop()`; `start()`; re-deliver A; `harness.capturePage` NOT re-invoked (D9).
  - **Edge — double `stop()`** — second call is no-op idempotent.
  - **Failure — no `ack` on shutdown** — spy on `delivery.ack` records 0 calls on shutdown path; only `nack` fires. **At-least-once invariant.**

  **Green.** In `runProfiler.ts`:
  - `stop()` sets `this.stopping = true`; aborts the controller.
  - Each worker checks `stopping` after each pipeline step (captured / fanout / arbitrated / before commit); if set AND grace elapsed, nack-transient `detail: "shutdown"` and break.
  - `stop()` Promise awaits all worker promises (each settles via ack or nack). Cap with `setTimeout(grace + PROFILER_SHUTDOWN_HARD_KILL_MS, hardKill)` — on hard-kill, force-nack remaining workers and resolve.
  - Preserve `processedJobIds` Map across stop/start (D9). Comment-pin intent.

  > **Implementer note**: `Promise.race([Promise.all(workers), timeout(grace)])` is tempting but loses per-worker nack-on-grace. Loop workers; per-worker grace deadline.

  ### Task 5 — Red→Green: `decisionPath` matrix

  **Red.** Extend `commit.test.ts` + `retry.test.ts` (PRP-D) with `test.each` over D5:

  | Outcome | `decisionPath` |
  |---|---|
  | Happy commit | `["captured","fanout","arbitrated","committed"]` |
  | All verifiers fail | `["captured","fanout_failed"]` |
  | Capture throws | `["capture_failed"]` |
  | `ProfileStore.put` throws | `["captured","fanout","arbitrated","commit_failed"]` |
  | Poison (DLQ) | `["dlq"]` |

  **Green.** Push each step name to a `decisionPath` array as the pipeline progresses. In `runProfiler.ts`'s catch on `harness.capturePage` throw, emit `["capture_failed"]`. In `fanout.ts` on all-reject, emit `["captured","fanout_failed"]`. In `retry.ts` on poison, emit `["dlq"]`.

  > **Coordination**: EDITS three files PRPs C+D wrote. Run their suites unmodified after each edit; cite line ranges in PR.

  ### Task 6 — Red→Green: integration test (5 jobs)

  **Red.** `runProfiler.integration.test.ts` — single test:
  - Construct `createProfiler` against `InMemoryProfileQueue` + in-test memory `ProfileStore` + in-test memory `AuditStore` + `mockHarness()` (returns valid `PageCapture`) + PRP-A verifier stubs + `createArbiter()` stub + silent logger.
  - `start()`; `for i in 0..4: enqueue(validProfileJob(\`job-${i}\`))`; `waitFor(() => profileStore.size() === 5, 5000)`; assert `Date.now() - start < 5000`; `auditStore.rows().length === 5`.
  - **LRU dedupe**: record `mockHarness.capturePage.mock.calls.length` as `before`; re-enqueue the same 5 ids; `waitFor(() => queue.getDLQ().length === 0, 1000)`; assert mock calls unchanged from `before`.
  - `stop()`; assert `queue.getDLQ()` is empty.

  **Green.** No new impl if Tasks 1–5 are clean; this IS the cross-PRP drift detector. Runs in `pnpm test`. Smoke (Task 7) is the manual-only one.

  ### Task 7 — Green: smoke script

  Write `packages/profiler/scripts/smoke-profiler.ts`. Mirror `smoke-capture.ts`:

  - Hardcoded URL in source. Recommend `https://www.bbc.com/news` (PRP-C2 D5 already uses it; no extra Cloud quota; video-bearing so expect `trace_count === 4`). Comment-pin verification date.
  - Construct `createProfiler` with: `harness = createHarness()` (real Cloud SDK), `llm = createLlmClient()` (real Lobster Trap proxy), Cluster C verifiers (or PRP-A stubs as fallback), `arbiter = createArbiter({ llm })`, `queue = new InMemoryProfileQueue()`, in-script memory `ProfileStore` + `AuditStore`.
  - Enqueue ONE hardcoded `ProfileJob`; start; wait ≤ 60 s for commit; capture timings from audit row + per-step instrumentation.
  - Print `{"event":"summary","profileId":"...","captureMs":...,"fanoutMs":...,"arbiterMs":...,"commitMs":...,"totalMs":...,"trace_count":4}`.
  - Exit `0` on `trace_count === 4` (or `=== 3` for documented no-video URLs); exit `1` on any error or trace-count mismatch (D10).
  - **SECURITY** — never log full `PageCapture` / `domText`; structured summaries only (`{ contentHash, screenshotCount, videoCount }`). Lift the disclaimer from `smoke-capture.ts:19-20`.

  Add to `packages/profiler/package.json`:

  ```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "smoke": "tsx scripts/smoke-profiler.ts"
  }
  ```

  ### Task 8 — File coordination follow-ups

  - **Sentinel `verifier_blackout` rule** (feature line 253) — file follow-up
    targeted at `features/clusterA/policy-match-evaluation.md`'s
    `packages/policy/fixtures/permissive-baseline.json` (a one-line category rule).
    This PRP does NOT edit the fixture.
  - **Redis `processedJobIds` dedupe** (gotcha 257) — file `profiler-redis-dedupe.md`
    follow-up. v1 keeps in-process LRU; production multi-process deployment needs
    `SETNX` + TTL (Lua-script atomic to avoid `SET`+`EXPIRE` race).

  ### Task 9 — `CLAUDE.md § Stack` update

  Append:

  - **Profiler — tenant scoping + audit row + shutdown** (locked 2026-05-16) — Evidence URI rewrite `evidence/{advertiserId}/{contentHash}/{idx}.{ext}` (`commit.ts:rewriteEvidenceUri`). Audit row `{ advertiserId, jobId, profileId, lobstertrapTraceIds: [text, image, video?, arbiter], decisionPath, elapsedMs }`; trace-ID order fixed by verifier-kind enum, arbiter last. `PROFILER_SHUTDOWN_GRACE_MS` default 30000; `stop()` resolves when all in-flight settle (cap = grace + 5 s); `ack` NEVER on shutdown (at-least-once invariant). `processedJobIds` LRU preserved across stop/start in-process.

  ### Task 10 — Validation sweep

  ```bash
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r exec prettier --write .
  pnpm -r test
  pnpm -r build
  pnpm audit
  # Manual (requires real GEMINI_API_KEY + LOBSTERTRAP_PROXY_URL + BROWSER_USE_API_KEY):
  pnpm --filter @scout/profiler run smoke
  ```

  Expected smoke (happy):

  ```json
  {"event":"summary","profileId":"01J...","captureMs":3800,"fanoutMs":4200,"arbiterMs":900,"commitMs":12,"totalMs":8950,"trace_count":4}
  ```

  Exit `0`. Any nonzero → diagnose before merge.

  ## Validation gates

  - `pnpm -r exec tsc --noEmit` → 0 errors.
  - `pnpm --filter @scout/profiler test` → all 4 new test files green + all PRP-C/D tests still green.
  - `pnpm -r build` → clean.
  - **Manual smoke** — `pnpm --filter @scout/profiler run smoke`; expected output above. **Required to run at least once before stage** (feature line 138).
  - Manual grep: `grep -rn 'process\.env' packages/profiler/src` — hits ONLY in `config.ts`.
  - Manual grep: `grep -rn 'openai\|@google/genai' packages/profiler` — ZERO hits (foundation ESLint rule preserved).
  - Manual grep: `grep -rn 'console\.log.*capture' packages/profiler` — ZERO matches.

  ## Security guardrails

  - **Tenant scoping on evidence URIs** — Task 1's cross-advertiser disjointness is the regression guard. Feature line 247: "a regression here is a cross-tenant disclosure bug."
  - **No raw `domText` in audit rows or logs** — audit row carries only structured summaries (`jobId`, `profileId`, trace IDs, `decisionPath`, `elapsedMs`). Never `capture.domText`. Smoke print is structured-only (feature line 248).
  - **Tenancy isolation in queue-position logs** — D12: log `{ jobId, attempt, advertiserId }` and `{ jobId, pageUrl }` as separate events; never one cross-referencing both. Code-review check: `grep -rn 'pageUrl' packages/profiler/src/runProfiler.ts` and ensure no co-occurrence with `advertiserId` in the same log object.
  - **No cookie/session pooling** — harness emits fresh session per capture (line 152); this PRP preserves that. `createProfiler` adds no session pool; smoke invokes `harness.capturePage` once per job.
  - **No env reads outside `config.ts`** — only `config.ts` reads `PROFILER_SHUTDOWN_GRACE_MS`, `PROFILER_SHUTDOWN_HARD_KILL_MS`, `PROFILER_PROCESSED_LRU_SIZE`. Smoke reads sponsor env indirectly via each package's `config.ts`.
  - **No silent `ack` on shutdown** — D8 + Task 4 pin; `runProfiler.shutdown.test.ts` asserts `ack.mock.calls.length === 0` on shutdown path. At-least-once depends on it.
  - **No fail-open on commit error** — D13: `auditStore.put` failure logs `audit_dropped` and proceeds, but the *profile* must commit or the job must nack. Never silent-`ack` a job whose profile didn't reach `ProfileStore`.

  ## Out of scope — file as follow-ups

  - **Redis-backed `processedJobIds`** (gotcha 257) — multi-process dedupe via `SETNX`+TTL. File as `profiler-redis-dedupe.md`. v1 in-process LRU is single-process-safe.
  - **Per-tenant queue isolation** — separate streams per `advertiserId` for rate-limit fairness. v1 shares one FIFO; gate's `RATE_LIMIT` handles fairness.
  - **Dashboard read-side tenant-filtering** — belt-and-suspenders for URI rewrite (open question (A)+(C), line 239/242). File as dashboard PRP's concern.
  - **Sentinel `verifier_blackout` rule** (line 253) — file as `policy-match-evaluation.md`'s concern; one-line fixture addition.
  - **Combined-modality verifier** (`collapse_text_image`, line 273) — hint wired by PRP-D; impl is Cluster C follow-up.
  - **Cost-tripwire calibration** — smoke's `totalMs`/`fanoutMs` output calibrates PRP-D's defaults; demo-seeding PRP's job.
  - **Audit-row factor-out** — refactor inline builders in `commit.ts` + `retry.ts` into a shared `auditRow.ts`. Schema pinned here; factor-out is a v2 nit.

  ## Anti-Patterns

  - Don't add tenant filtering to harness (`harness-capture-page.md:150` avoided this; URI namespacing is profiler's seam). Tempted to push `advertiserId` into `CaptureOptions`? Read D1 first.
  - Don't `ack` on shutdown. Task 4 + D8 pin. Integration test's spy on `delivery.ack` is the regression guard. `ack`-on-abort silently drops jobs.
  - Don't bypass `rewriteEvidenceUri` for "demo-only" file paths. Every `evidenceRefs[].uri` MUST flow through it — even fixture-replay needs the prefix or the dashboard tenant filter 404s on demo day.
  - Don't introduce a NEW `AuditStore.put` call site. PRPs C+D already wrote call sites in `commit.ts` and `retry.ts`; this PRP UPGRADES the row schema at those existing sites. A second site forks the schema.
  - Don't clear `processedJobIds` on `stop()`. D9 — preserved across stop+start. Clearing makes intra-process stop+start re-process recently-acked jobs.
  - Don't move the URI rewrite to a downstream `ProfileStore.put` hook. Pin the boundary at `commit.ts` so `PageProfileSchema.parse` sees the rewritten URI; any earlier point lets unrewritten URIs flow into the audit row and dashboard.
  - Don't add a `smoke-profiler.ts` CLI arg surface. Fixtures live in source (mirror `smoke-capture.ts`); inputs comparable across runs. A `--url <X>` flag breaks that.
  - Don't ship a smoke that swallows `null` trace IDs. D10 + Task 7 pin: null `lobstertrapTraceId` on non-degraded run is a sponsor-tech wire breakage and MUST fail the script. Veea claim depends on it.
  - Don't log `job.pageUrl` and `job.advertiserId` in the same structured event. D12 splits to two events.

  ## Final cluster checklist (PRPs A → E)

  When this PRP merges, the entire Cluster B profiler chain is shipped:

  - [ ] PRP-A merged — contracts + agent stubs.
  - [ ] PRP-B merged — `InMemoryProfileQueue`.
  - [ ] PRP-C merged — `runProfiler` loop + fanout + commit + LRU.
  - [ ] PRP-D merged — cost trip-wire + TTL + retry.
  - [ ] PRP-E merged — URI rewrite + full audit row + shutdown + integration + smoke.
  - [ ] Smoke executed ≥ once with real sponsor env; output in PR description.
  - [ ] `CLAUDE.md § Stack` updated with profiler bullet.
  - [ ] Follow-up filed for `verifier_blackout` sentinel rule in `permissive-baseline.json`.
  - [ ] Follow-up filed for Redis `processedJobIds` dedupe.
  - [ ] `FEATURE-TODO.md` row `profiler-real-loop.md` ticked `[x]` per `MEMORY.md` rule.

  ## Confidence: 8 / 10

  Polish PRP atop four green prereqs. Highest-risk: edits spanning PRPs C+D (audit
  row + `decisionPath` matrix + shutdown semantics). Integration test (Task 6) is
  the drift detector — broken edits red-light before smoke even runs. Smoke (Task 7)
  needs one real Cloud-quota slot for verification.

  The `stop()` resolution semantic (D8) is the subtle bit — "resolve when all in-flight
  settle, capped at grace + hard-kill" requires the worker loop to nack-then-await
  rather than abort-and-go. Task 4's two grace branches pin both outcomes; reviewer
  should walk the abort path to catch a sneaky `ack` on the timeout branch.
