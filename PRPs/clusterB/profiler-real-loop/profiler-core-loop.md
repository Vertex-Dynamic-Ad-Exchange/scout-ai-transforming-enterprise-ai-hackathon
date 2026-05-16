name: "Profiler — PRP-C: Core consumer loop (TDD)"
description: |

  Third of five PRPs for `features/clusterB/profiler-real-loop.md`. Wires
  PRP-A's contracts + PRP-B's in-memory `ProfileQueue` into `runProfiler(deps)`:
  bounded concurrency, `Promise.allSettled` verifier fan-out with per-verifier
  `AbortController`, arbiter call, `PageProfile` assembly + commit, idempotent
  re-delivery via per-process LRU. **Out of this PRP** — TTL heuristic, cost
  trip-wire, `degradationHint` floor, retry/backoff/poison, tenant URI rewrite,
  shutdown polish, integration + smoke.

  **Prereqs**: PRP-A (`profiler-contracts.md`) + PRP-B (`profiler-in-memory-queue.md`).
  **Follow-ups**: PRP-D (cost/retry/TTL/hint) + PRP-E (tenancy/shutdown/smoke).

  ## TDD discipline

  Every task is red → green → refactor. Confirm the failure mode is the
  *expected* one before writing impl. `vi.mock` is per-test (no shared mock
  module); PRP-B's in-memory queue is the test rig, NOT a mock.

  ## Why this PRP exists separately

  Feature-file runtime body is ~200 lines + 4 siblings ≈ 700 lines of impl +
  ~17 test files; one PRP busts the 300-line cap and produces an unreviewable
  diff. This PRP lands the load-bearing seam (`ProfilerDeps`, `createProfiler`,
  `runProfiler`, `fanout`, `commit`) so PRP-D and PRP-E extend without
  re-opening the core. Specifically:

  - `degradationHint` flows into `VerifierContext`; profiler only branches on
    `"drop_video"` (skip `video.verify`). Floor/ceiling + rolling-window → PRP-D.
  - On capture-fail / all-verifiers-fail, profiler calls
    `nack({ kind: "transient", detail: "..." })` with **no `retryAt`**; PRP-D
    wires backoff + attempt cap + poison routing.
  - TTL = flat `PROFILER_TTL_DEFAULT_SECONDS ?? 21600`; heuristic → PRP-D.
  - `EvidenceRef.uri` = harness-emitted, with `TODO(PRP-E)` marker; tenant
    prefix → PRP-E.
  - `stop()` aborts the shared signal; in-flight jobs commit→ack OR
    nack-transient with `detail: "shutdown"`. 30s grace + no-ack-on-shutdown
    invariant IS pinned here (load-bearing for at-least-once); full polish → PRP-E.

  ## Hackathon constraint check

  - **Warm path, NOT hot path.** `runProfiler` not importable from
    `packages/gate/**` (foundation ESLint
    `PRPs/foundation-ad-verification.md:157-159`). Throughput- + cost-bound.
  - **Lobster Trap.** Every verifier→LLM call routes via `@scout/llm-client`
    (verifier-side, not profiler-side). This PRP's contribution: the audit row
    aggregates the 4 `lobstertrapTraceId`s; Task 14 makes a null on a
    non-degraded job observable as a counter.
  - **Gemini.** 3 Pro vision calls + 1 arbiter per profile, parallel — the
    "heavy use" claim (`features/architecture.md:63`) lives here.
  - **Plug-and-play.** `ProfilerDeps` is the DI seam; tests inject fakes,
    production wires `@scout/{store,harness}` + verifier-package factories.

  ## CLAUDE.md rules that bite

  - TS strict, NodeNext, ES2022, ESM.
  - 300-line cap: `runProfiler.ts` ≤ 200; `fanout.ts` ≤ 150; `commit.ts` ≤ 150.
  - Dep ask: `ulid@^2.3.0` (Apache-2.0, original spec — gotcha 261 forbids
    `ulidx`/`id128`). NO `lru-cache` — hand-roll ≤ 40 lines (D9).

  ## Decisions (locked here)

  | # | Question | Locked |
  |---|---|---|
  | D1 | `ProfilerDeps` field order | `{ harness, verifiers: { text, image, video, combined? }, arbiter, queue, profileStore, auditStore, logger, clock?, signal? }`. `combined` optional in this PRP; PRP-D throws at `createProfiler` if hint=`collapse_text_image` && missing. |
  | D2 | `PROFILER_CONCURRENCY` | `4` (matches harness Cloud cap, `features/clusterB/harness-capture-page.md:161`). Env-read in profiler's `config.ts` only. |
  | D3 | `PROFILER_VERIFIER_TIMEOUT_MS` | `30000`. Per-verifier. Total worst-case ≤ 8s capture + 30s + commit ≈ 60s. |
  | D4 | `humanReviewThreshold` | Static `0.7`. Profiler does NOT load `Policy` (would cross gate's tenancy seam, feature line 81). Future-work: enqueue on `ProfileJob`. |
  | D5 | ULID lib | `ulid@^2.3.0` (gotcha 261). One callsite: `commit.ts`. |
  | D6 | `Logger` | Inline minimal `Logger` interface in `@scout/shared/src/interfaces/logger.ts` (Option ii — gotcha 268). Verified 2026-05-16: foundation didn't land it. Shape: `{ info(o), warn(o), error(o) }`. Re-export via shared barrel. |
  | D7 | Audit trace-ID order | Fixed `[text, image, video, arbiter]` by verifier-kind enum (gotcha 263), not call-completion. |
  | D8 | Audit row shape | Foundation has no `AuditRow` schema; PRP-E owns it. This PRP: `AuditStore.put(row: unknown)`; writes plain `{ advertiserId, jobId, profileId?, lobstertrapTraceIds, decisionPath, elapsedMs }`. |
  | D9 | LRU impl | Hand-rolled `Map` + insertion-order eviction. Cap `PROFILER_PROCESSED_LRU_SIZE ?? 1024`. |
  | D10 | LRU key | `job.id` (ULID), NOT `contentHash`. Same `job.id` → short-circuit `ack`; same `contentHash` → re-commit (overwrites — cache refresh). |
  | D11 | Per-verifier abort | `AbortSignal.any([deps.signal ?? new AC().signal, AbortSignal.timeout(timeoutMs)])` per call. Plumbed via `VerifierContext.abortSignal`. Node ≥ 20. |
  | D12 | Verifier-rejection synth | `AgentVerdict { verifier: <k>, decision: "HUMAN_REVIEW", categories: [], detectedEntities: [], evidenceRefs: [], modelLatencyMs: 0, lobstertrapTraceId: null }`. Arbiter sees 3-of-3 always. |
  | D13 | All-three-fail | `nack({ kind: "transient", detail: "all_verifiers_failed" })`. NO `retryAt` (PRP-D). `ProfileStore.put` not called; `AuditStore.put` IS called with `decisionPath: ["captured", "fanout_failed"]`. |
  | D14 | Tenant URI rewrite | **Deferred PRP-E.** `commit.ts` emits `capture.screenshots[i].uri` + `capture.videoSamples[i].uri` unchanged with `// TODO(PRP-E)` markers. |

  ## All Needed Context

  ```yaml
  - file: features/clusterB/profiler-real-loop.md
    section: "Pipeline 17-25; runProfiler+fanout 73-79; arbiter 81; PageProfile
      83-91; LRU 105; audit 109; test matrix 113-138; Security 244-253;
      Gotchas 255-268"
  - file: PRPs/clusterB/profiler-real-loop/profiler-contracts.md      # Prereq A
  - file: PRPs/clusterB/profiler-real-loop/profiler-in-memory-queue.md # Prereq B
  - file: PRPs/clusterB/harness-browser-mode.md                       # precedent
  - file: packages/shared/src/schemas/profile.ts                      # PageProfileSchema
  - file: packages/shared/src/schemas/capture.ts                      # PageCapture
  - file: packages/shared/src/interfaces/harness.ts                   # Harness, HarnessError
  - file: packages/shared/src/schemas/primitives.ts                   # DecisionSchema
  - file: features/architecture.md                                    # 41-55, 107-109, 147-152
  - file: PRPs/foundation-ad-verification.md                          # 147-159, 209-213, 243-245
  - file: packages/harness/src/factory.ts                             # factory precedent
  - url: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static
  - url: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled
  - url: https://github.com/ulid/spec#specification
  - url: https://vitest.dev/api/vi.html#vi-usefaketimers
  ```

  ## Files

  ```
  packages/profiler/src/
    config.ts        + __tests__/config.test.ts       (PROFILER_* env reads only)
    runProfiler.ts   + __tests__/runProfiler.test.ts  (≤200 lines)
    fanout.ts        + __tests__/fanout.test.ts       (≤150)
    commit.ts        + __tests__/commit.test.ts       (≤150)
    lru.ts           + __tests__/lru.test.ts          (≤40)
    index.ts         (REWRITTEN — barrel: runProfiler + createProfiler)
  packages/profiler/package.json  (add @scout/{harness,llm-client,store}, ulid)
  packages/shared/src/interfaces/
    logger.ts        + logger.test.ts                 (D6)
  packages/shared/src/index.ts    (append: export * from "./interfaces/logger.js")
  ```

  ## Target contracts

  ```ts
  // index.ts
  export { runProfiler, createProfiler } from "./runProfiler.js";
  export type { ProfilerDeps, ProfilerHandle } from "./runProfiler.js";

  // runProfiler.ts
  import type { Harness, Verifier, Arbiter, ProfileQueue, ProfileStore,
    AuditStore, Logger } from "@scout/shared";

  export interface ProfilerDeps {
    harness: Harness;
    verifiers: { text: Verifier; image: Verifier; video: Verifier; combined?: Verifier };
    arbiter: Arbiter;
    queue: ProfileQueue;
    profileStore: ProfileStore;
    auditStore: AuditStore;
    logger: Logger;
    clock?: () => number;
    signal?: AbortSignal;
  }
  export interface ProfilerHandle { start(): Promise<void>; stop(): Promise<void>; }
  export function createProfiler(deps: ProfilerDeps): ProfilerHandle;
  export function runProfiler(deps: ProfilerDeps): Promise<void>;
  ```

  ## Pseudocode

  **`runProfiler.ts`** (~18 lines):
  ```ts
  export async function runProfiler(deps: ProfilerDeps): Promise<void> {
    const cfg = profilerConfig();
    const seen = createLru(cfg.processedLruSize);
    const abort = new AbortController();
    deps.signal?.addEventListener("abort", () => abort.abort(), { once: true });
    const inflight = new Set<Promise<void>>();
    const slot = createSemaphore(cfg.concurrency);
    for await (const { job, ack, nack } of deps.queue.consume({
      signal: abort.signal, visibilityTimeoutMs: cfg.visibilityTimeoutMs })) {
      await slot.acquire();
      const p = handleJob(deps, cfg, seen, job, ack, nack, abort.signal)
        .finally(() => { inflight.delete(p); slot.release(); });
      inflight.add(p);
    }
    await Promise.allSettled([...inflight]);   // graceful drain
  }
  // handleJob: dedupe → harness.capturePage → fanout → arbiter → commit → ack|nack
  ```

  **`fanout.ts`** core: build `kinds = capture.videoSamples.length ? [text,image,video] : [text,image]`;
  if `ctx.degradationHint === "drop_video"` drop `video`. `TODO(PRP-D)`: floor/
  ceiling. `Promise.allSettled` with `AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(timeoutMs)])`
  per call. Map settled → fulfilled.value OR `synthHumanReview(kind, reason, logger)`:
  emit `logger.warn({ event: "verifier_rejected", verifier, reason })` and
  return `{ verifier, decision: "HUMAN_REVIEW", categories:[], detectedEntities:[],
  evidenceRefs:[], modelLatencyMs:0, lobstertrapTraceId:null }` (D12).

  **`commit.ts`** core: build `profile: PageProfile = { id: ulid(), url:
  capture.url, contentHash: capture.contentHash, categories: arb.consensusCategories,
  detectedEntities: arb.consensusEntities, evidenceRefs: [...screenshots, ...videos]
  /* TODO(PRP-E) tenant prefix */, capturedAt: capture.capturedAt, ttl:
  PROFILER_TTL_DEFAULT_SECONDS /* TODO(PRP-D) heuristic */ }`. `PageProfileSchema.parse(profile)`
  (defense-in-depth). `await profileStore.put(job.advertiserId, profile)`. Then
  `try { auditStore.put({ advertiserId, jobId, profileId, lobstertrapTraceIds:
  orderedTraceIds(verdicts, arb), decisionPath: ["captured","fanout","arbitrated","committed"],
  elapsedMs }) } catch (e) { logger.warn({ event: "audit_dropped", reason }) }`
  — audit is best-effort (Task 13).

  ## Task order (TDD)

  ### Task 1 — Deps + barrel + Logger
  Add `ulid@^2.3.0` + workspace deps. Land `shared/interfaces/logger.ts`
  (8-line `Logger` interface, D6) + `satisfies Logger` compile-test on
  `console`. Re-export via shared barrel. Replace profiler `index.ts` stub
  with `export { runProfiler, createProfiler } from "./runProfiler.js"`;
  stub body throws `Error("PRP-C Task 2")` so barrel lands green.

  ### Task 2 — `createProfiler` compile-test
  Red: `runProfiler.test.ts` has `satisfies ProfilerDeps` on a hand-built
  full dep set; omit one required field with `@ts-expect-error` to pin
  missing-field detection. Green: define `ProfilerDeps` (D1); export
  `createProfiler` returning `ProfilerHandle` whose `start()` is still stub.

  ### Task 3 — Happy: 1 job, 3 verifiers happy, arbiter agrees (feature line 116)
  Red: enqueue 1 job into `createMemoryProfileQueue()`; fake `Harness`
  returns valid `PageCapture` with `videoSamples: [poster, frame]`; 3 stub
  verifiers return `ALLOW` + non-null `lobstertrapTraceId`; arbiter returns
  `ALLOW`/conf 0.9. Drive `createProfiler(deps).start()` with a deadline
  resolving on queue-drain. Assert: (a) `profileStore.put` × 1, (b)
  `PageProfileSchema.parse(profile)` succeeds, (c) `auditStore.put` × 1
  with `lobstertrapTraceIds.length === 4` all non-null in D7 order,
  (d) LRU contains `job.id` (re-deliver to confirm short-circuit), (e)
  `harness.capturePage(job.pageUrl, { geo: job.geo })` called once.
  Green: minimal `runProfiler` body + `fanout.ts` + `commit.ts` (each
  ≤ 60 lines initially).

  ### Task 4 — Happy: no video → `video.verify` NOT invoked
  Red: `capture.videoSamples = []`; spy on `video.verify.mock.calls.length === 0`;
  audit row has **3** trace IDs (NOT null-filled slot — pin this).
  Green: gate `video` kind on `capture.videoSamples.length > 0` in `fanout.ts`.

  ### Task 5 — Idempotent re-delivery (LRU short-circuit)
  Red: enqueue same `job.id` twice; assert `harness.capturePage.mock.calls.length === 1`,
  second tuple `ack`s immediately. Green: `handleJob` first checks
  `seen.has(job.id)` → `await ack()` + return; on commit success, `seen.set(job.id, true)`.
  Land `lru.ts` (≤ 40 lines per D9) + tests (insert → evict at cap → has() false).

  ### Task 6 — `(advertiserId, contentHash)` collision overwrites
  Red: pre-seed `profileStore` with `(A, hash-X)`; enqueue different `job.id`
  whose capture yields `(A, hash-X)`. Assert one row, fresher `capturedAt`.
  Green: no new logic — `profileStore.put` from PRP-B is idempotent-by-key.

  ### Task 7 — Bounded concurrency (10 jobs, `PROFILER_CONCURRENCY=4`)
  Red: enqueue 10 jobs; wrap `harness.capturePage` in entry/exit counter;
  assert `max(inflightCount) <= 4` over the run; all 10 commit. Green:
  semaphore (queue-of-resolvers — push on `acquire`, shift on `release`;
  inline in `runProfiler.ts` if ≤ 30 lines, else `semaphore.ts`).

  ### Task 8 — Per-verifier timeout fires `AbortError` (fake timers)
  Red: `image.verify` = `vi.fn` that listens to `ctx.abortSignal.abort` and
  rejects with `DOMException("aborted", "AbortError")`. `vi.useFakeTimers()`;
  drive job; `vi.advanceTimersByTime(31_000)`. Assert: (a) mock observed
  `signal.aborted === true`, (b) synthetic `HUMAN_REVIEW` placeholder for
  image, (c) arbiter saw 3 verdicts, (d) `profileStore.put` invoked,
  (e) `process.on("unhandledRejection")` spy: 0 calls. Green:
  `AbortSignal.any([ctx.abortSignal, AbortSignal.timeout(cfg.timeoutMs)])`
  per D11 in `fanout.ts`.

  ### Task 9 — One verifier rejects (sync throw), two succeed
  Red: `image.verify` throws synchronously; `text` + `video` succeed.
  Assert: arbiter called with **3** verdicts (2 real + synth); profile
  commits; `ack` fires (NOT `nack`). Green: covered by Task 8's
  `synthHumanReview`; this is the sync-throw leg.

  ### Task 10 — All three verifiers reject → nack-transient (D13)
  Red: all 3 throw. Assert: `nack({ kind: "transient", detail: "all_verifiers_failed" })`
  (no `retryAt`); `profileStore.put` NOT called; `auditStore.put` IS called
  with `decisionPath: ["captured", "fanout_failed"]`; `ack` NOT called.
  Green: in `handleJob` after fanout, count verdicts with non-null
  `lobstertrapTraceId` OR `decision !== "HUMAN_REVIEW"`; if 0, write
  audit-failed row + nack-transient + return early (skip arbiter + commit).
  **TODO(PRP-D)** comment: retryAt + attempt cap + poison routing.

  ### Task 11 — `harness.capturePage` throws `BLOCKED` → nack-transient
  Red: harness throws `new HarnessException(HarnessError.BLOCKED, "consent_wall")`.
  Assert: `nack({ kind: "transient", detail: "capture_failed:BLOCKED" })`;
  `profileStore.put` NOT called; `auditStore.put` called with
  `decisionPath: ["capture_failed"]`. Green: try/catch around
  `harness.capturePage`; on `HarnessException`, audit-failed + nack.
  **TODO(PRP-D)**: retryAt; certain codes route to poison after attempt cap.

  ### Task 12 — `ProfileStore.put` throws → nack-transient + audit `commit_failed`
  Red: `profileStore.put` throws. Assert: `nack({ kind: "transient", detail: "profile_store_unavailable" })`;
  `auditStore.put` called with `decisionPath: [..., "commit_failed"]`.
  Green: try/catch around `commitProfile`; on throw, audit-failed + nack.

  ### Task 13 — `AuditStore.put` throws → log `audit_dropped` and STILL `ack`
  Red: `auditStore.put` throws; `profileStore.put` succeeds. Assert: `ack`
  called (NOT `nack`); `logger.warn` called with `{ event: "audit_dropped", ... }`.
  Audit is best-effort (feature line 131). Green: already in `commit.ts`
  pseudocode (try/catch around `auditStore.put`). **Critical**: future
  refactor flipping default silently loses audit trail — this test guards.

  ### Task 14 — `verifier.lobstertrapTraceId === null` on non-degraded job
  Red: `text.verify` returns `AgentVerdict { decision: "ALLOW", lobstertrapTraceId: null }`;
  other 2 verifiers + arbiter return non-null. Assert: (a) profile commits
  (brand-safety is gate's fail-closed job, not profiler's), (b) `logger.warn`
  `{ event: "lobstertrap_trace_missing", verifier: "text", jobId, advertiserId }`,
  (c) audit `lobstertrapTraceIds[0] === null` (gap observable), (d) metric
  `logger.info({ event: "metric", name: "lobstertrap_trace_missing_total", value: 1 })`
  fires. Green: in `commit.ts` `orderedTraceIds`, slot per D7; on null,
  emit warn + metric. PRP-E owns the full audit-row trace-ID-chain suite.

  ### Task 15 — `_lobstertrap.verdict === "DENY"` propagates (feature line 134)
  Red: all 3 verifiers return `AgentVerdict { decision: "DENY", lobstertrapTraceId: "ltr-deny-X", categories: [{ label: "policy_violation", confidence: 1.0 }] }`;
  arbiter combines → `ArbiterDecision { decision: "DENY", confidence: 1.0, consensusCategories: [...] }`.
  Assert: profile commits; `profile.categories[0].label === "policy_violation"`;
  audit has 3 non-null verifier + 1 arbiter trace IDs. Green: no new
  code — pipeline carries `DENY` transparently. Pins the demo moment.

  ### Task 16 — Schema-conformance sweep + validation gates
  Red: sweep test pipes Task 3's emitted `PageProfile` through
  `PageProfileSchema.parse()` independently (defense-in-depth, mirrors
  harness's exit-time parse). Green: no new code. Then:
  ```bash
  pnpm -r exec tsc --noEmit && pnpm -r exec eslint . --fix && \
    pnpm -r exec prettier --write . && pnpm -r test && pnpm -r build
  grep -rn 'process\.env' packages/profiler/src     # ONLY config.ts
  grep -rn 'openai\|@google/genai' packages/profiler/src   # MUST BE EMPTY
  ```

  ## Validation gates

  - `pnpm --filter @scout/profiler test` — all green.
  - `pnpm --filter @scout/profiler exec tsc --noEmit` — clean.
  - `pnpm -r build` — clean.
  - `grep -rn 'process.env' packages/profiler/src` → `config.ts` only.
  - `grep -rn 'openai\|@google/genai' packages/profiler/src` → empty.
  - `wc -l` caps: `runProfiler.ts ≤ 200`, `fanout.ts ≤ 150`, `commit.ts ≤ 150`,
    `lru.ts ≤ 40`.
  - No new top-level dep beyond `ulid` + three `@scout/*` workspace deps.

  ## Security guardrails

  - No `openai`/`@google/genai` import in `packages/profiler/**` (foundation
    ESLint). Verifiers injected; profiler never instantiates `LlmClient`.
  - No env access outside `config.ts`. Reads only `PROFILER_CONCURRENCY`,
    `PROFILER_VERIFIER_TIMEOUT_MS`, `PROFILER_PROCESSED_LRU_SIZE`,
    `PROFILER_TTL_DEFAULT_SECONDS`, `PROFILER_VISIBILITY_TIMEOUT_MS`,
    `PROFILER_SHUTDOWN_GRACE_MS`. Never `GEMINI_API_KEY`/`BROWSER_USE_API_KEY`.
  - No raw `capture.domText` in logs (256 KiB untrusted, feature line 248).
    Loggers see `{ jobId, advertiserId, url, contentHash, modes, elapsedMs, warnings }`.
  - `ProfileStore.put` keyed `(advertiserId, contentHash)` — never `contentHash`
    alone (locked in PRP-A).
  - Tenant evidence URI rewrite DEFERRED PRP-E (D14); the cross-advertiser
    disjointness test (feature line 129) lands there.
  - No silent ALLOW: every failure path nacks-transient or audit-fails; never
    `ack` without commit.
  - No harness session pooling (feature line 252); fresh `capturePage` per job.

  ## Out of scope

  **→ PRP-D (cost/retry/TTL/hint):**
  - `costTripwire.ts` rolling-window guard + soft/hard transitions (feature 99-103).
  - `degradationHint` floor semantic (feature 103 + test 126).
  - `collapse_text_image` + missing `combined` slot throws (feature 127 + gotcha 265).
  - TTL heuristic table (feature 93-97 + test 128).
  - `retry.ts` — backoff, attempt cap, poison routing (feature 107 + test 124).
  - DLQ audit `kind: "profile_job_dlq"` (feature 107).
  - Cost-tripwire-mid-batch test (feature 125).

  **→ PRP-E (tenancy/shutdown/integration/smoke):**
  - Tenant-scoped evidence URI rewrite (feature 89 + 129 + 247); the two
    `TODO(PRP-E)` markers in `commit.ts` are the seam.
  - Graceful-shutdown mid-job test (feature 133) — full assertion suite.
  - Full audit-row trace-ID-chain completeness test (feature 109 + 132).
  - 5-job end-to-end integration test (feature 136).
  - `smoke-profiler.ts` (feature 138) — real `GEMINI_API_KEY` + Lobster Trap.
  - `verifier_blackout` sentinel coordination w/ policy-fixtures PRP (feature 253).

  ## Anti-Patterns

  - N independent `for await of queue.consume()` consumers (race + double-deliver).
    ONE consumer; workers are semaphore-bounded downstream `Promise`s (feature 77).
  - `Promise.all` instead of `allSettled` — first rejection abandons others'
    `fetch`-in-flight; tokens still bill (gotcha 259).
  - Unbounded fanout — N×3 verifiers burns Gemini Pro quota; semaphore is the
    budget guard, not polish.
  - `process.env.*` outside `config.ts`; `openai`/`@google/genai` imports
    anywhere in `packages/profiler/**`.
  - Loading `Policy` from `PolicyStore` for threshold (feature 81) — crosses
    gate's tenancy seam; use static `0.7` (D4).
  - LRU keyed on `contentHash` (D10) — would swallow legitimate re-captures.
  - LRU `seen.set` BEFORE `ack`. Order: commit → ack → LRU. Crash between
    commit and ack MUST NOT skip re-delivery (at-least-once).
  - `ack` on shutdown — nack-transient `detail: "shutdown"`; next consumer takes it.
  - Logging full `PageCapture` (feature 248); structured summaries only.
  - `ulidx`/`id128` (gotcha 261) — pin `ulid`.
  - Adding `lru-cache` dep — hand-roll (≤ 40 lines, D9).
  - Skipping the `lobstertrap_trace_missing` metric (Task 14) — silent gaps
    are the worst sponsor-tech failure mode.

  ## Confidence: 7 / 10

  Strengths: `ProfilerDeps` locks cleanly against PRP-A; factory mirrors
  `createHarness()`; test rig is PRP-B's queue (not mocks); failure paths
  exercise at-least-once; sponsor-tech wire testable at audit-row seam.

  Risks:
  - **R1 — PRP-A/B shape drift.** Drafted in parallel; if PRP-A renames a
    field on `AgentVerdict` or grows `NackReason`, commit/nack callsites
    break. Lock A first.
  - **R2 — `AbortSignal.any` availability.** Node ≥ 20 (CLAUDE.md) — verified.
  - **R3 — `AuditStore` unlocked.** D8 opaque `put(row: unknown)`; if
    foundation lands `AuditRowSchema` before PRP-E, may need `parse`; Task
    16 sweep catches.
  - **R4 — `combined` slot.** D1 optional; PRP-D enforces throw if hint set
    + slot absent. Coordinate if PRP-D lands first.
  - **R5 — Semaphore tail-latency.** Queue-of-resolvers, not `Promise.race`
    over an array (memory leak).

  ## Discovered During Work (2026-05-16 execution)

  1. **`ProfileStore` + `AuditStore` interfaces filled inline.** D1 +
     pseudocode import them from `@scout/shared`, but PRP-A D17 punted to
     foundation and foundation has not executed. PRP-C now lands minimal
     interfaces at `packages/shared/src/interfaces/{profileStore,auditStore}.ts`
     (alongside `logger.ts`) and appends three lines to the shared barrel.
     `AuditStore.put(row: unknown)` per D8; `ProfileStore.{put,get}` keyed
     `(advertiserId, contentHash)` per PRP-A § Security guardrails. PRP-E
     swaps `AuditStore.put`'s param to a real `AuditRowSchema`.
  2. **`handleJob.ts` extracted from `runProfiler.ts`.** With the full
     pipeline inlined, `runProfiler.ts` lands at ~240 lines — over the
     200-line cap. Extraction keeps the public surface (`runProfiler` +
     `createProfiler`) in `runProfiler.ts` (118 lines) and pulls the
     per-job state machine into `handleJob.ts` (148 lines). Files section
     updated accordingly.
  3. **Task 8 fake-timer dropped.** The PRP's `vi.useFakeTimers()` plan
     interacts badly with vitest 2.1's `AbortSignal.timeout` mocking on
     this stack — the test hangs in the `for await` loop after timers are
     restored. Equivalent assertion targets (a)–(e) hold with a short real
     `PROFILER_VERIFIER_TIMEOUT_MS=50` and real timers; see
     `runProfiler.integration.test.ts` Task 8.
  4. **Test-side busy-loop break for nack-no-retryAt.** D13 + PRP-B D5
     compose into a microtask busy loop on permanent-failure tests
     (Tasks 10/11/12): the queue re-delivers immediately, the loop fails
     again, on and on until the test's outer abort fires — thousands of
     iterations × `vi.fn()` call-array growth = OOM in ~5 minutes. Fix is
     test-only: `driveUntilFirstAudit` aborts the controller from inside
     `auditStore.put.mockImplementationOnce`, breaking the cycle on the
     first observed failure. Production semantics unchanged — PRP-D's
     backoff + attempt-cap + poison-routing is what removes the loop in
     prod.
