You are a senior Node/TypeScript backend engineer fluent in Redis-backed job-queue topologies (Streams + consumer groups, visibility timeouts, DLQs), bounded-concurrency worker pools, `Promise.allSettled` fan-out where partial verifier failure must not poison the whole profile, idempotency keys on warm-path jobs that are *queued from the hot path under load*, cost-aware degradation (warm-path Gemini Pro spend has to bend before SLA does), and the architectural discipline of treating the profiler as the only writer to `ProfileStore` so the hot-path cache it reads from is single-producer / multi-consumer by construction.

## PRIORITY:

**P0 — warm-path-blocking, demo-load-bearing, the only consumer of every Cluster C row.** Corresponds to the `profiler-real-loop.md` row in `FEATURE-TODO.md:52-56` under *Cluster B — Warm path*. Independent of the four agent prompts in Cluster C (`FEATURE-TODO.md:58-69`) — each verifier is called through the `Verifier` interface this PRP locks, and the foundation stubs (`packages/agents/text-verifier/src/index.ts:1`, `packages/agents/image-verifier/src/index.ts:1`, `packages/agents/video-verifier/src/index.ts:1`, `packages/agents/arbiter/src/index.ts:1` — all currently `export {};`) are valid-shape until the prompt PRPs land. Reads `Harness.capturePage` from `@scout/harness` (the body lands in the peer Cluster B row `features/clusterB/harness-capture-page.md`; this PRP consumes whatever shape that PRP commits — the typed-contract handoff is the seam).

Until this lands: the gate's cache-miss enqueue (`features/clusterA/gate-verdict-logic.md:24-26`) goes to a queue that nobody drains, so the *second* bid on a fresh page DENYs identically to the first — the architecture's stated *"subsequent bids on that page get the cached answer"* property (`features/architecture.md:32-33`) is false at demo time, and the live demo's *"cache miss → DENY-then-warm scenario"* moment (`FEATURE-TODO.md:79-82`) can only be faked with hand-seeded `ProfileStore` rows. The Veea-Award narrative's *"every agent → LLM call routes through Lobster Trap"* property (`features/architecture.md:75-77`) is also untested in the live system: profiler is where four agents emit four LLM calls per page, so it's where Lobster Trap is *actually exercised* end-to-end.

**Latency stakes — explicitly NOT hot path.** Warm path: seconds-to-minutes per page is acceptable (`features/architecture.md:55`). The profiler **must not** be invoked from `packages/gate/**` — the foundation ESLint boundary at `PRPs/foundation-ad-verification.md:157-159` already blocks that import; preserve it. The constraint that binds is *throughput* (jobs/sec) and *cost* (Gemini Pro tokens/job), not single-job latency.

## FEATURE:

Replace the foundation stub at `packages/profiler/src/index.ts:1` (currently `export {};`) with the real `runProfiler(deps)` consumer loop described in `features/architecture.md:41-55` and `features/architecture.md:107-109`, **plus** lock the cross-package contracts foundation hand-waved (`PRPs/foundation-ad-verification.md:136`) but never landed in `@scout/shared`: `ProfileJob`, `Verifier`, `AgentVerdict`, `ArbiterDecision`, and a `ProfileQueue` interface. Same pattern as `features/clusterA/policy-match-evaluation.md` locking `PolicyMatchResult` and `features/clusterB/harness-capture-page.md` locking `PageCapture` — the consumer-side contracts go in `@scout/shared`; the provider package implements against them.

Pipeline:

```
ProfileQueue.consume(jobId) ─▶ Harness.capturePage(job.pageUrl, {geo: job.geo})
                            ─▶ Promise.allSettled([textVerifier, imageVerifier, videoVerifier?])
                            ─▶ Arbiter.combine(verdicts[], capture)
                            ─▶ assemble PageProfile
                            ─▶ ProfileStore.put(profile, {ttl})
                            ─▶ AuditStore.put(traceRow)
                            ─▶ ProfileQueue.ack(jobId)
                          (on throw) ─▶ ProfileQueue.nack(jobId, {retryAt})
```

End state:

- **New shared schemas** (additive to `@scout/shared`):
  - `packages/shared/src/schemas/job.ts` — `ProfileJobSchema`. Foundation lists `schemas/job.ts` in `PRPs/foundation-ad-verification.md:135` but never lands it; this PRP creates it. Shape:
    ```ts
    ProfileJob = {
      id: string,                       // ULID; idempotency key — see Gotchas
      pageUrl: string,                  // url; the bid's pageUrl (pre-redirect)
      advertiserId: string,             // alpha-num; tenant scoping
      policyId: string,                 // the policy that triggered the enqueue (audit only — profiler does NOT evaluate the policy)
      geo: string,                      // alpha-2; passes through to Harness.capturePage opts.geo
      enqueuedAt: string,               // ISO8601; for queue-age metrics + DLQ ttl
      attempt: number,                  // int >=1; 1 on first dispatch, ++ on each nack-retry
      degradationHint: "none" | "drop_video" | "collapse_text_image",  // Q6 cost trip-wire (architecture.md Q6, PRPs/foundation-ad-verification.md:29) — see CostTripwire below
    }
    ```
  - `packages/shared/src/schemas/agentVerdict.ts` — `AgentVerdictSchema` + `ArbiterDecisionSchema`. These are the verifier→arbiter and arbiter→profile-commit contracts; foundation `PRPs/foundation-ad-verification.md:136` names `intent.ts` but not these. Shape:
    ```ts
    AgentVerdict = {
      verifier: "text" | "image" | "video",
      decision: Decision,               // ALLOW | DENY | HUMAN_REVIEW (reuse @scout/shared DecisionSchema)
      categories: Category[],           // verifier's per-label confidences (reuse CategorySchema from profile.ts:3)
      detectedEntities: DetectedEntity[],
      evidenceRefs: EvidenceRef[],      // citations into the PageCapture's screenshots/dom_snippets/video_frames
      modelLatencyMs: number,           // int >=0; the Gemini Pro round-trip cost contribution
      lobstertrapTraceId: string | null,  // null only on a verifier that took the no-LLM degraded path; non-null is the norm
    }

    ArbiterDecision = {
      decision: Decision,
      confidence: number,               // [0,1]; same scale as PolicyMatchResult.confidence so the gate ambiguity dial is consistent
      consensusCategories: Category[],  // the agreed-on categories, fed into PageProfile.categories
      consensusEntities: DetectedEntity[],
      disagreements: { kind: "category" | "entity", label: string, perVerifier: Record<"text"|"image"|"video", number> }[],
      humanReviewRecommended: boolean,
      lobstertrapTraceId: string | null,
    }
    ```
  - Add barrel re-exports at `packages/shared/src/index.ts` (currently `packages/shared/src/index.ts:1-5` — append two lines).

- **New shared interfaces** (`packages/shared/src/interfaces/` — same first-occupant note as `features/clusterB/harness-capture-page.md`; whichever PRP lands first creates the directory, the second appends):
  - `interfaces/verifier.ts` — `Verifier { kind: "text" | "image" | "video"; verify(capture: PageCapture, ctx: VerifierContext): Promise<AgentVerdict> }`. `VerifierContext` carries `{ advertiserId, policyId, taxonomyHint?: string[], abortSignal: AbortSignal }`. The four Cluster C prompt PRPs implement against this; foundation's existing agent stubs (`packages/agents/text-verifier/src/index.ts:1` etc.) are upgraded to export a `createTextVerifier(): Verifier` factory returning the still-hardcoded valid `AgentVerdict` shape (so this PRP can land while the prompt PRPs are unstarted).
  - `interfaces/arbiter.ts` — `Arbiter { combine(verdicts: AgentVerdict[], capture: PageCapture, ctx: ArbiterContext): Promise<ArbiterDecision> }`. `ArbiterContext` carries `{ advertiserId, policyId, humanReviewThreshold: number, abortSignal: AbortSignal }`. `agent-arbiter-scoring.md` (Cluster C) implements the real combine; the foundation stub returns a constant `ArbiterDecision` here.
  - `interfaces/profileQueue.ts` — `ProfileQueue { enqueue(job: ProfileJob): Promise<void>; consume(opts: { signal: AbortSignal; visibilityTimeoutMs: number }): AsyncIterableIterator<{ job: ProfileJob; ack(): Promise<void>; nack(reason: NackReason): Promise<void> }> }`. `NackReason = { kind: "transient" | "poison"; detail: string; retryAt?: string }`. **This is the seam the gate's cache-miss path writes to** — gate calls `enqueue` only (`features/clusterA/gate-verdict-logic.md:24-26`), profiler calls `consume`.

- **Real `runProfiler()`**: `packages/profiler/src/runProfiler.ts` exports the loop; `packages/profiler/src/index.ts` becomes the barrel exporting `runProfiler` + `createProfiler` (returns `{ start(): Promise<void>; stop(): Promise<void> }` — graceful-shutdown shape, mirrors Fastify's `app.close()` pattern that gate uses at `packages/gate/src/index.ts` after the gate PRP lands). Body ≤ 200 lines — extract `fanout.ts` (verifier `Promise.allSettled` orchestration + per-verifier timeout), `commit.ts` (`PageCapture` + `AgentVerdict[]` + `ArbiterDecision` → `PageProfile` mapping + `ProfileStore.put` + `AuditStore.put`), `costTripwire.ts` (the Q6 degradation decision — see below), and `retry.ts` (`NackReason` classification + `retryAt` computation) as siblings. Each ≤ 150 lines.

- **Dependency injection at the seam** — `createProfiler(deps: ProfilerDeps)` where `ProfilerDeps = { harness: Harness, llm: LlmClient, verifiers: { text: Verifier, image: Verifier, video: Verifier }, arbiter: Arbiter, queue: ProfileQueue, profileStore: ProfileStore, auditStore: AuditStore, clock?: () => number, logger: Logger }`. Tests inject in-memory fakes; production wires `@scout/store` impls + `@scout/harness` + `@scout/llm-client`. **The profiler does not import `openai` or `@google/genai` directly** — the foundation ESLint rule (`PRPs/foundation-ad-verification.md:151-154`) blocks it; verifiers receive their `LlmClient` instance via `VerifierContext` indirectly (each verifier package's factory accepts `llm: LlmClient` at construction — same shape as `createLlmClient()` itself in `PRPs/foundation-ad-verification.md:175`).

- **Bounded concurrency** — `runProfiler` runs N concurrent job handlers, where `N = PROFILER_CONCURRENCY ?? 4`. Implemented as a fixed-size promise pool (one `for-await-of` consumer fanning out into N parallel workers, **not** N independent consumers — that would race on `consume()` and double-deliver). Why bounded: each job triggers up to 3 Gemini Pro calls (text + image + video verifier) plus 1 arbiter call; at unbounded concurrency we burn the Gemini Pro quota in seconds. Why 4 by default: matches the Cloud-API concurrency cap on `browser-use-sdk` that the harness PRP noted at `features/clusterB/harness-capture-page.md:161` (the harness, not the verifiers, is the throughput-binding hop).

- **Verifier fan-out** — `Promise.allSettled([text.verify(cap, ctx), image.verify(cap, ctx), video?.verify(cap, ctx)])` with per-verifier timeout (`PROFILER_VERIFIER_TIMEOUT_MS ?? 30000`, threaded via `AbortController` into `ctx.abortSignal`). Failures are **partial**, not total: if `text` succeeds + `image` succeeds + `video` rejects, the arbiter receives the two settled verdicts plus a synthetic `AgentVerdict { verifier: "video", decision: "HUMAN_REVIEW", ... }` whose presence in `disagreements[]` flags the gap, rather than dropping the job. Total failure (all three reject) → `nack({ kind: "transient", ... })` and the job retries with `attempt + 1`.

- **Arbiter call** — `arbiter.combine(verdicts, capture, { advertiserId: job.advertiserId, policyId: job.policyId, humanReviewThreshold: policy?.escalation.humanReviewThreshold ?? 0.7, abortSignal })`. **The profiler does NOT load the `Policy` to fetch the threshold** — that would cross a tenancy seam that gate already owns (`features/clusterA/gate-verdict-logic.md:102`, `features/clusterA/policy-match-evaluation.md:115-116`). Instead, the threshold default (0.7) is used when policy data isn't on the job; future-work: enqueue the threshold *on the `ProfileJob`* alongside `policyId` — filed in *Out of scope* below.

- **`PageProfile` assembly** — map `(PageCapture, ArbiterDecision) → PageProfile`:
  - `id`: ULID, freshly generated (the **profile** id, not the job id; one job → one profile, but profile ids are stable so future cache lookups work).
  - `url`: `capture.url` (post-redirect; what verifiers actually saw — this is the cache *value* key, distinct from cache *lookup* key).
  - `contentHash`: `capture.contentHash` byte-for-byte.
  - `categories`: `arbiter.consensusCategories`.
  - `detectedEntities`: `arbiter.consensusEntities`.
  - `evidenceRefs`: built from `capture.screenshots[].uri` (kind `screenshot`) + `capture.videoSamples[].uri` (kind `video_frame`) + any `dom_snippet` URIs the text-verifier returned. **Tenant scoping**: every evidence URI MUST be advertiser-namespaced (`evidence/{advertiserId}/{contentHash}/{idx}`) so the dashboard cannot serve advertiser A's screenshot to advertiser B's audit view. The harness emits URIs without an advertiser prefix (`features/clusterB/harness-capture-page.md:135-140` keeps tenancy out of harness); the profiler is the seam that adds it on commit.
  - `capturedAt`: `capture.capturedAt`.
  - `ttl`: derived per `Cache TTL` below.

- **Cache TTL** (`features/architecture.md:148` — *"Aggressive TTL on news/UGC sites, longer on static"*) — v1: heuristic on `capture.metadata.ogType` and `capture.url` host:
  - `article`, `news`, `video.*` → `PROFILER_TTL_NEWS_SECONDS ?? 1800` (30 min).
  - `website` / unset → `PROFILER_TTL_DEFAULT_SECONDS ?? 21600` (6 h).
  - hosts matching a known-UGC regex (`(reddit|twitter|x\.com|tiktok|youtube\.com\/shorts)`) → `PROFILER_TTL_UGC_SECONDS ?? 600` (10 min).
  - Constants in `costTripwire.ts`'s sibling `ttlPolicy.ts`; tests pin both the host-regex match and the og-type lookup.

- **Cost trip-wire (Q6, `PRPs/foundation-ad-verification.md:29`)** — `costTripwire.ts` exposes `chooseDegradation(spendWindow: SpendWindow, baseHint: DegradationHint): DegradationHint`. The trip-wire is a *rolling-window cost guard*:
  - `SpendWindow` tracks the sum of `verdict.modelLatencyMs` (as a cost proxy — token usage from `LlmClient.usage` if present, else latency) across the last `PROFILER_COST_WINDOW_MS ?? 60000` ms.
  - When window cost > `PROFILER_COST_WINDOW_SOFT` (e.g., the headroom limit), set hint to `"drop_video"` — `runProfiler` skips the `video` verifier on subsequent jobs; `videoSamples` are still captured but not classified.
  - When window cost > `PROFILER_COST_WINDOW_HARD`, escalate to `"collapse_text_image"` — runs a single multimodal verifier call combining DOM text + screenshots in one Gemini Pro vision call. (Implementation note: this collapse is *not* this PRP's job to implement the combined prompt — see *Out of scope*. The hint is consumed by Cluster C: each verifier reads `ctx.degradationHint` and can choose to no-op accordingly. This PRP wires the *signal*, not the prompts that consume it.)
  - The `degradationHint` on the *job* (foundation's intended Q6 surface from `PRPs/foundation-ad-verification.md:29`) is treated as the **floor**: the profiler may upgrade severity in-flight (window-cost-driven) but never downgrade below what the enqueuer requested. Gate enqueues at `"none"` by default; demo-bidstream-seeding (`FEATURE-TODO.md:79-82`) can pre-set `"drop_video"` to force the demo path.

- **Idempotency** — `job.id` is the dedupe key. `ProfileStore.put` is keyed on `(advertiserId, capture.contentHash)` — a second job with the same `(pageUrl, advertiserId)` that produces the same `contentHash` overwrites the same profile row (idempotent commit). A second job with the same `job.id` that's already been `ack`d is a no-op: profiler maintains a small `processedJobIds` LRU (`PROFILER_PROCESSED_LRU_SIZE ?? 1024`) and short-circuits to `ack` immediately. This handles the at-least-once-delivery property of every reasonable Redis-Streams setup; without it, a consumer-group rebalance causes a re-deliver, which causes a re-capture, which costs `browser-use` quota AND a Gemini Pro fan-out for nothing.

- **Retry policy** — `nack({ kind: "transient", retryAt })` schedules `retryAt = now + min(2^attempt * PROFILER_BACKOFF_BASE_MS, PROFILER_BACKOFF_CAP_MS)`. After `PROFILER_MAX_ATTEMPTS ?? 5`, the job moves to DLQ via `nack({ kind: "poison", ... })`. **Poison handling is observable, not silent**: DLQ entries flow into `AuditStore` with `kind: "profile_job_dlq"` so the dashboard's `dashboard-verdict-views.md` can surface them. *Why* explicitly observable: a silently-poisoned job means the gate keeps DENY-spamming the same page forever (cache miss → enqueue → DLQ → no profile committed → cache miss …) — the architecture's *"acceptable for a brand-new page; not acceptable if it happens for the same page twice"* line at `features/architecture.md:147` is exactly this failure mode.

- **Tenant-scoped audit** — every `AuditStore.put` row carries `{ advertiserId, jobId, profileId, lobstertrapTraceIds: [verifier...arbiter], decisionPath: ["captured", "fanout", "arbitrated", "committed"], elapsedMs }`. **Lobster Trap trace IDs are aggregated, not replaced** — the audit row shows the *chain* of LLM calls per profile (text-verifier traceId + image-verifier traceId + video-verifier traceId + arbiter traceId, in order). This is the *every agent → LLM call routes through Lobster Trap* claim made executable: if any trace ID in the chain is null on a non-degraded job, the profile must not commit. Test it.

- **Graceful shutdown** — `runProfiler` registers a single `AbortController`; `stop()` aborts it, lets in-flight jobs finish their current step (capture or fanout or commit) up to `PROFILER_SHUTDOWN_GRACE_MS ?? 30000`, then nacks any remaining as `{ kind: "transient", detail: "shutdown" }`. **Never lose a job at shutdown** — `ack` only fires after a successful commit; an aborted commit nacks. This is what makes the queue at-least-once delivery safe.

- **Tests — exhaustive matrix**, not 1/1/1, because this is the warm path's full integration surface and the Veea-Award demo's only honest exercise of the Lobster Trap seam. Match Cluster A's density (`features/clusterA/gate-verdict-logic.md:36-47`):
  - **Schema conformance** — `ProfileJobSchema`, `AgentVerdictSchema`, `ArbiterDecisionSchema` round-trip a hand-built valid value through `parse()`. Also: a `runProfiler` happy-path test asserts the emitted `PageProfile` passes `PageProfileSchema.parse()` at commit time (defense-in-depth, same pattern as harness's `parse()` at function exit).
  - **`Verifier`, `Arbiter`, `ProfileQueue` interface compile-tests** — `satisfies Verifier` / `satisfies Arbiter` / `satisfies ProfileQueue` on the foundation stubs (after this PRP upgrades them to export factories returning the interface-typed object). Catches contract drift at type-check time.
  - **Happy: one job, three verifiers happy, arbiter agrees** — capture → 3 verifiers → arbiter → commit → ack. Asserts: exactly 1 `ProfileStore.put`, exactly 1 `AuditStore.put`, 4 non-null `lobstertrapTraceId`s in the audit row (3 verifiers + 1 arbiter), `processedJobIds` LRU contains `job.id`.
  - **Happy: no video on page (`capture.videoSamples == []`)** — `video` verifier is **not** invoked (assert via spy: `video.verify.mock.calls.length === 0`). `ArbiterDecision.disagreements` does not contain a `video` placeholder. Audit row has 3 trace IDs (text + image + arbiter), not 4.
  - **Happy: idempotent re-delivery** — same `job.id` arrives twice; second delivery short-circuits to `ack` immediately without invoking `harness.capturePage`. (Spy assertion.)
  - **Happy: capture produces same `contentHash` as an existing profile** — `(advertiserId, contentHash)` already in `ProfileStore`; `runProfiler` overwrites in place (asserts a single row, not two), the new profile's `capturedAt` is fresher than the old's, and TTL is reset.
  - **Edge — Bounded concurrency** — enqueue 10 jobs against `PROFILER_CONCURRENCY=4`; assert at no point during the run does `harness.capturePage.mock.calls.length - successfulCommits > 4`. Uses `Promise` introspection or a counter increment in the spied factory.
  - **Edge — One verifier rejects, two succeed** — `image.verify` throws; `text` + `video` succeed. Arbiter receives 3 verdicts (the 2 real + 1 synthetic `HUMAN_REVIEW` for image with `disagreements` flagged), arbiter returns `decision: HUMAN_REVIEW`, profile commits, job acks. Failure does NOT nack.
  - **Edge — All three verifiers reject** — `nack({ kind: "transient" })` with `retryAt` set; `attempt` increments on the requeued job; `ProfileStore.put` NOT called; `AuditStore.put` IS called with `decisionPath: ["captured", "fanout_failed"]` (the failure itself is auditable).
  - **Edge — Per-verifier timeout** — `image.verify` never resolves; after `PROFILER_VERIFIER_TIMEOUT_MS` the abort signal fires and `image.verify`'s promise rejects with `AbortError`. Job proceeds with 2-of-3 verifiers (same as the "one rejects" path). Asserts no leaked promise after timeout (`process.on("unhandledRejection")` spy).
  - **Edge — Harness throws `BLOCKED` / `CONSENT_WALL_UNRESOLVED`** — capture failure is a per-job failure, not a verifier failure: profile is not committed, `nack({ kind: "transient" })` is issued, `retryAt` is set. After `PROFILER_MAX_ATTEMPTS` the job DLQs and an `AuditStore` row with `kind: "profile_job_dlq"` is written.
  - **Edge — Cost trip-wire trips mid-batch** — feed 20 jobs; force `LlmClient.usage` returns to drive window-cost above `PROFILER_COST_WINDOW_SOFT` after job 8. Assert: jobs 1–8 invoke all 3 verifiers; jobs 9–N invoke 2 (text + image); window-cost drops back below soft after jobs complete; profiler re-promotes to all-3. Each transition logged via `logger.info({ event: "cost_tripwire_change", from, to })`.
  - **Edge — `degradationHint: "drop_video"` on the job** — even with the window-cost at zero, the *floor* is respected: `video.verify` is not invoked. (Pins the *floor, not ceiling* semantic.)
  - **Edge — `degradationHint: "collapse_text_image"` on the job** — `text.verify` and `image.verify` are not invoked separately; instead, a hypothetical `combined` verifier is invoked. **Profiler does not implement the combined verifier in this PRP** — the test asserts that when the hint is `"collapse_text_image"` AND `verifiers.combined` is absent in `deps`, the profiler throws at `createProfiler` time (fail-loud at construction, not silent at job-time). File the combined-verifier implementation in *Out of scope*.
  - **Edge — TTL heuristic table** — test pages with `metadata.ogType ∈ {article, news, video.movie, website, null}` × host ∈ {`example.com`, `reddit.com`, `news.example.com`} produce the expected TTL constant. Table-driven (`vitest test.each`).
  - **Edge — Tenant-scoped evidence URI** — `capture.screenshots[0].uri === "file:///tmp/scout-evidence/abc123/0.png"` becomes `profile.evidenceRefs[0].uri === "evidence/advertiser-A/abc123/0.png"` (or whatever the namespacing rule lands as — see *Open questions*). Pin the rewrite rule; a regression here is a cross-tenant disclosure bug.
  - **Failure — `ProfileStore.put` throws** — commit fails; job is NOT acked; `nack({ kind: "transient", detail: "profile_store_unavailable" })`; `AuditStore.put` still records the attempt with `decisionPath: [..., "commit_failed"]` so the failure is observable.
  - **Failure — `AuditStore.put` throws** — audit is non-SLA-binding; profiler logs `audit_dropped` (`features/clusterA/gate-verdict-logic.md:97` precedent) and proceeds to `ack`. The audit is best-effort; the profile commit is the source of truth. **Test this explicitly** — a future refactor that flips this default silently loses the audit trail.
  - **Failure — `verifier.lobstertrapTraceId === null` on a non-degraded job** — the audit row records the gap; the profile DOES still commit (we don't punish brand-safety on a sponsor-tech wire breakage), but a metric `lobstertrap_trace_missing_total` is incremented. *Why commit instead of fail-closed?* Because brand-safety is per-bid (gate's job to fail-closed); profile commit is per-page (profiler's job to keep moving). The Lobster Trap audit gap is observable, not blocking.
  - **Failure — Shutdown mid-job** — `stop()` while job is in `fanout`. In-flight verifier calls receive the abort signal; `runProfiler` waits up to `PROFILER_SHUTDOWN_GRACE_MS` for the current step; on timeout, in-flight job is nacked as `{ kind: "transient", detail: "shutdown" }`. **No `ack` on shutdown** — the next consumer must see it.
  - **Failure — `_lobstertrap.verdict === "DENY"` on a verifier's LLM call** — the verifier surfaces a `lobstertrap_denied` AgentVerdict (this is the Cluster C verifier prompts' responsibility to translate from `LlmClient.chat`'s response; profiler treats it as the verifier's `decision: DENY`). Arbiter receives a 3-DENY consensus → `decision: DENY`, profile commits with `decision`-encoded categories, audit row has the 3 trace IDs. *This is the Veea-Award demo moment for the warm path* — make sure the demo can show it.

- **Integration test against an in-memory `ProfileQueue` + memory `ProfileStore`** — `packages/profiler/src/__tests__/runProfiler.integration.test.ts`. Enqueues 5 jobs against a real `runProfiler` instance with stubbed verifiers; asserts 5 profiles committed within a bounded time; asserts the LRU prevents 5 duplicate re-deliveries.

- **Smoke script** — `packages/profiler/scripts/smoke-profiler.ts`: bootstraps a single-job run end-to-end with real `@scout/harness`, real `@scout/llm-client` (real Lobster Trap proxy required, real `GEMINI_API_KEY` required), real verifier stubs (or real ones if the Cluster C PRPs have landed), and a memory `ProfileQueue`. Prints `{ profileId, captureMs, fanoutMs, arbiterMs, commitMs, totalMs, trace_count }`. Excluded from `pnpm test`; runnable as `pnpm --filter @scout/profiler run smoke`. Required to run **at least once before stage** so the demo's full warm-path chain isn't first-touched on demo day (same discipline as harness smoke at `features/clusterB/harness-capture-page.md:160-161`).

## EXAMPLES:

- `packages/profiler/src/index.ts:1` — current `export {};` stub from foundation task 7 (`PRPs/foundation-ad-verification.md:253-257`). This PRP replaces it with a barrel exporting `createProfiler` + `runProfiler`.
- `packages/profiler/package.json:11-13` — current `dependencies` contains only `@scout/shared`. This PRP adds `@scout/harness` + `@scout/llm-client` + `@scout/store` (workspace deps) + `ulid` (or `nanoid` — see *Open questions*; do **not** add `uuid` if `ulid` is already a transitive dep). NO direct `openai` / `@google/genai` (foundation ESLint rule, `PRPs/foundation-ad-verification.md:151-154`).
- `packages/profiler/src/index.ts` vs. `packages/gate/src/index.ts` — both are foundation-stubbed `export {};` today; both become package barrels. Gate is HTTP-driven (Fastify), profiler is queue-driven (long-running). Use `gate-verdict-logic.md` as the precedent for *layered handler + helpers under 150 lines each*; do NOT use Fastify in profiler (no HTTP surface).
- `packages/agents/text-verifier/src/index.ts:1`, `packages/agents/image-verifier/src/index.ts:1`, `packages/agents/video-verifier/src/index.ts:1`, `packages/agents/arbiter/src/index.ts:1` — all currently `export {};`. This PRP upgrades each to export a `createXVerifier(deps): Verifier` factory returning a hardcoded valid `AgentVerdict` (or `ArbiterDecision`). The Cluster C prompt PRPs replace the body with the real prompt; the contract this PRP locks is what they implement against.
- `packages/harness/src/index.ts:1` — currently `export {};`. After `features/clusterB/harness-capture-page.md` lands, this exports `createHarness(): Harness`. This PRP consumes `Harness.capturePage` via `deps.harness.capturePage(job.pageUrl, { geo: job.geo, timeoutMs, captureVideo: job.degradationHint !== "drop_video" })`. **The `captureVideo: false` wire from `degradationHint` is what folds harness-side cost-savings into the trip-wire** — the harness PRP's `CaptureOptions.captureVideo` field (`features/clusterB/harness-capture-page.md:39`) was reserved precisely for this caller.
- `packages/store/src/index.ts:1` — currently `export {};`. Foundation task 4 (`PRPs/foundation-ad-verification.md:243-245`) lands `ProfileStore` + `PolicyStore` + `AuditStore`. This PRP adds the **`ProfileQueue`** interface to `@scout/shared/interfaces/` and an in-memory + ioredis impl in `@scout/store` — same pattern as the other three stores.
- `packages/shared/src/schemas/profile.ts:22-31` — `PageProfileSchema`. The commit step builds this; field-by-field correspondence with `(PageCapture, ArbiterDecision)` is laid out in *FEATURE — `PageProfile` assembly* above.
- `packages/shared/src/schemas/profile.ts:9-13` — `DetectedEntitySchema { name, type, confidence }`. Arbiter's `consensusEntities` flows into `profile.detectedEntities` 1:1; `type` carries the IAB-or-vendor taxonomy hint the verifier emitted.
- `packages/shared/src/schemas/profile.ts:16-20` — `EvidenceRefSchema { kind, uri }`. Tenant scoping is added at commit time — see *Security guardrails*.
- `packages/shared/src/schemas/profile.ts:30` — `ttl` is `int().positive()`. **Seconds** by convention (`features/clusterA/gate-verdict-logic.md:55` confirms). A unit bug here silently lets profiles live 1000× too long; pin in a test.
- `packages/shared/src/schemas/bid.ts:8` — `BidVerificationRequest.geo` is alpha-2. `ProfileJob.geo` reuses the same regex (`/^[A-Z]{2}$/`); profiler passes it through to `Harness.capturePage` opts.
- `packages/shared/src/schemas/verdict.ts:11-19` — `VerificationVerdictSchema`. The profiler does **not** emit a `VerificationVerdict` (that's gate's job); but `lobstertrapTraceId` round-trip is the property both surfaces share. The arbiter's audit row aggregates trace IDs that ultimately surface in `dashboard-verdict-views.md`.
- `packages/shared/src/schemas/primitives.ts:3` — `DecisionSchema { ALLOW | DENY | HUMAN_REVIEW }`. `AgentVerdict.decision` and `ArbiterDecision.decision` reuse it.
- `packages/shared/src/index.ts:1-5` — current barrel; append `export * from "./schemas/job.js"`, `export * from "./schemas/agentVerdict.js"`, and three `export * from "./interfaces/*.js"` lines.
- `features/architecture.md:41-55` — the warm-path pipeline in plain English. Every section above maps to one phrase in those lines.
- `features/architecture.md:50-53` — *"Cross-check: the three verdicts go to a fourth `arbiter` agent that flags disagreements. Disagreement above a threshold → `HUMAN_REVIEW` queue, not a silent average."* — this is the `humanReviewRecommended` path that surfaces as `decision: HUMAN_REVIEW` from the arbiter; profiler commits the profile regardless and the gate's next read decides what to do (re-evaluate against the requesting policy).
- `features/architecture.md:107-109` — module boundary: `profiler/` is the warm-path worker; consumes `ProfileJob` from the queue; emits `PageProfile` to the profile store. *Nothing else.* No HTTP surface, no direct LLM call, no policy evaluation.
- `features/architecture.md:147-152` — failure modes the architecture doc explicitly assigns: profile miss on a hot page (gate enqueues + profiler drains); LLM provider outage (`_lobstertrap.verdict === "DENY"` → verifier surfaces DENY); page changes (TTL); prompt injection (every verifier→LLM call through Lobster Trap by construction); adversarial advertiser (tenant scoping in queue + store + evidence URIs).
- `features/clusterA/gate-verdict-logic.md:24-26` — gate's cache-miss enqueue: `ProfileQueue.enqueue({ url, advertiserId, policyId })`. This PRP locks the matching `consume` half of the contract; gate's PRP did not need to (gate writes only). **Coordination point**: the field set on `ProfileJob` (`pageUrl` vs. gate's `url`) must align before either PRP merges. Recommend renaming on gate side or accepting the inconsistency with an alias in the schema — see *Open questions*.
- `features/clusterA/gate-verdict-logic.md:84-87` — the queue interface foundation lands; gate's PRP names the seam but lets this PRP define its shape.
- `features/clusterA/policy-match-evaluation.md:122-123` — `creative_tag` rule kind no-op note; relevant because profiler does NOT produce `creativeTags` (creative tags describe the advertiser's creative, not the page). Same out-of-scope note carries here.
- `features/clusterB/harness-capture-page.md:39` — `CaptureOptions.captureVideo` boolean; the Q6-trip-wire wire on the harness side; profiler is the caller that toggles it.
- `features/clusterB/harness-capture-page.md:154` — the `_lobstertrap` declared-vs-detected intent inspection happens on every verifier call profiler dispatches. **Harness does NOT route through Lobster Trap** (browser-use Cloud's internal LLM is the agreed exception); verifiers DO. Profiler is the seam where the boundary is preserved by *not crossing it directly* (no `openai` import, no `@google/genai` import).
- `PRPs/foundation-ad-verification.md:29` — Q6 lock: text + image + video + arbiter, each behind a `Verifier` interface; cost trip-wire lives here. Foundation defers the trip-wire to this PRP — implement it.
- `PRPs/foundation-ad-verification.md:115-203` — `LlmClient.chat({...}, intent)` shape. The verifiers consume this via `VerifierContext.llm`; profiler never imports it directly. (Asserted by foundation ESLint rule on profiler imports.)
- `PRPs/foundation-ad-verification.md:147-159` — ESLint boundary rules. `openai` and `@google/genai` are blocked everywhere except `llm-client/**`; profiler is squarely *not* an exception. Verify in a smoke commit (the harness PRP makes the same point at `features/clusterB/harness-capture-page.md:148`).
- `PRPs/foundation-ad-verification.md:253-257` — foundation task 7 lands the profiler `main()` skeleton that "round-trips one job through the in-memory queue, calls the stubbed pipeline, writes a stubbed `PageProfile`. " This PRP replaces the round-trip body with the real loop; foundation's skeleton is the test-rig for the integration test.
- **Greenfield otherwise** — no in-repo queue-consumer precedent. External references in *DOCUMENTATION*.

## DOCUMENTATION:

- ioredis Redis Streams + consumer groups: <https://github.com/redis/ioredis#streams> — the production-shape `ProfileQueue` impl uses `XREADGROUP` + `XACK` + `XAUTOCLAIM` for visibility-timeout reclaim. (Foundation Q3 locked ioredis.)
- Redis Streams visibility-timeout semantics + `XAUTOCLAIM` for orphaned-message recovery: <https://redis.io/docs/latest/develop/data-types/streams/#consumer-groups>
- `Promise.allSettled` semantics — what *Settled* means for the partial-failure fan-out: <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled>
- `AbortController` + `AbortSignal.timeout` + `AbortSignal.any` — the per-verifier timeout plumbing and shutdown propagation: <https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static>
- Node `process.on("unhandledRejection")` — the "no leaked promise after timeout" assertion in the timeout test: <https://nodejs.org/api/process.html#event-unhandledrejection>
- vitest `test.each` for the TTL heuristic + degradation-hint matrices: <https://vitest.dev/api/#test-each>
- vitest `vi.useFakeTimers` + `vi.advanceTimersByTime` for the cost-window-rolling test (60 s window): <https://vitest.dev/api/vi.html#vi-usefaketimers>
- ULID spec (lexicographically sortable, ~timestamp-prefixed, dedupe-friendly job IDs): <https://github.com/ulid/spec#specification>
- Gemini model latency / pricing (the cost-tripwire's calibration target — Pro is the warm-path model, Flash is the hot path): <https://ai.google.dev/gemini-api/docs/models#gemini-2.5-pro> — pin `gemini-2.5-pro` ID per foundation lock (`PRPs/foundation-ad-verification.md:216-217`); do not use `*-latest` aliases.
- **Pin Gemini model IDs**: profiler itself makes no LLM call; verifiers do. The pin lives in the Cluster C verifier PRPs and in `@scout/llm-client/src/models.ts`. Reference, not re-pin.
- **Lobster Trap policy syntax** — the `_lobstertrap` declared-intent payload format per call: <https://github.com/veeainc/lobstertrap#bidirectional-metadata-headers>. The verifier prompts populate it; profiler's contribution is to assert non-null trace IDs in the audit row, not to construct the intent itself.
- Lobster Trap policy action vocabulary (`ALLOW / DENY / LOG / HUMAN_REVIEW / QUARANTINE / RATE_LIMIT`): <https://github.com/veeainc/lobstertrap#configuration>. The vocabulary aligns 1:1 with `Decision` + the arbiter's `humanReviewRecommended` + the queue's `RATE_LIMIT`-like behaviour from the cost trip-wire (rate-limiting Gemini Pro spend is the moral equivalent of the Veea policy verb).

## OTHER CONSIDERATIONS:

- **Sponsor-tech relevance: BOTH (heavy).**
  - **Gemini** — this is the *warm-path Gemini Pro story*: up to 3 vision-capable Pro calls per profile, parallel fan-out, arbitrated. The Gemini Award narrative *"heavy use across both paths"* (`features/architecture.md:63`) is *primarily* this PRP — hot-path Flash is one call per ambiguous bid; warm-path Pro is 3–4 calls per profiled page. The submission video's *"Pro for verifiers, Flash for the gate"* sentence is true *because of this PRP*.
  - **Lobster Trap** — this is also where the *every-agent-LLM-call-through-Lobster-Trap* claim is most tested. Profiler dispatches 4 calls per profile (3 verifiers + 1 arbiter); each is routed via `@scout/llm-client` (verifier-side, not profiler-side import). The audit row's aggregated trace-ID chain is what makes the Veea-Award demo's *"prompt-injection defense at the seam"* claim **executable** — a hostile page that tries to jailbreak the text-verifier shows up as a `_lobstertrap.verdict: "DENY"` on the text trace ID, which surfaces as a `decision: DENY` from that verifier, which the arbiter respects, which commits a `decision: DENY` profile, which the gate honors on the next bid.

- **Open question — `ProfileQueue` production impl primitive.**
  - **(A) Redis Streams + consumer groups (`XADD` / `XREADGROUP` / `XACK` / `XAUTOCLAIM`).** Visibility timeouts, at-least-once delivery, orphan-reclaim built in. The production shape.
  - **(B) Redis Lists (`LPUSH` / `BRPOPLPUSH` to a processing-list pattern).** Simpler API, no built-in DLQ, no built-in visibility-timeout.
  - **(C) Redis Pub/Sub.** Fire-and-forget; messages lost on consumer down. **Disqualifying** for a brand-safety system — call out to prevent.
  - **Recommend (A).** Foundation Q3 locked ioredis (`PRPs/foundation-ad-verification.md:26`); Streams is the consumer-group-friendly shape. In-memory impl ships for tests/dev; both impls satisfy the same `ProfileQueue` interface.

- **Open question — `ProfileJob.id` generator.**
  - **(A) ULID** — lexicographically sortable, timestamp-prefixed (cheap to use for queue-age metrics and DLQ-ttl).
  - **(B) Nanoid** — cryptographically random; smaller; not sortable.
  - **(C) UUIDv7** — sortable; broader ecosystem support; slightly larger than ULID.
  - **Recommend (A).** ULID's sortability lets us spot oldest-pending-job at a glance in `redis-cli XRANGE`; size (26 chars) is fine for a key prefix.

- **Open question — Cache TTL heuristic source.**
  - **(A) Per-host hardcoded map + `og:type` fallback** (the FEATURE section's v1).
  - **(B) Per-advertiser configurable via `Policy.escalation.ttlOverride?`.** Advertisers in regulated industries (financial services, healthcare) want stricter TTL.
  - **(C) Dynamic — measure verifier confidence variance across captures of the same URL and shorten TTL when it's high.**
  - **Recommend (A) for v1.** (B) needs a `PolicySchema` re-lock; (C) needs historical data we don't have. File both as follow-ups.

- **Open question — Idempotency key on `ProfileStore.put`.**
  - **(A) `(advertiserId, contentHash)`** — multi-tenant-safe; same page captured for advertiser A and advertiser B produce two separate `PageProfile` rows (correct — each sees the page in their own evidence-URI namespace).
  - **(B) `contentHash` alone, with `advertiserId` in a separate index column** — single source of truth per page, multi-tenant evidence views overlaid.
  - **Recommend (A).** Multi-tenant isolation is more important than profile-row de-duplication. The cost (≤N × profile rows for an N-advertiser page) is bounded by the cache hit rate; profiles for popular pages are reused within a tenancy.

- **Open question — Concurrent verifier invocation strategy.**
  - **(A) `Promise.allSettled` — wait for all (or timeout per-verifier), pass partial results to arbiter.** Cluster A's *"independent verification"* story; arbiter sees the gap as a disagreement.
  - **(B) `Promise.all` — fail the whole job if any verifier rejects, nack.** Simpler; loses partial value; turns transient verifier failures into job retries (more Gemini Pro spend, not less).
  - **(C) Sequential — text first, image only if text is ambiguous, video only if both are ambiguous.** Cost-optimal in the happy case; serializes a parallel-able workload; breaks the *"independent verification"* claim because text bias cascades to skipping image.
  - **Recommend (A).** Matches architecture's stated "independent verification"; partial failure is observable in the arbiter's `disagreements[]`, not silently dropped.

- **Open question — Arbiter input on partial-verifier-failure.**
  - **(A) Synthetic `HUMAN_REVIEW` placeholder for failed verifiers.** Arbiter sees a 3-of-3 input shape; `disagreements[]` flags the gap.
  - **(B) Pass only successful verdicts; arbiter receives a 2-of-3 input.** Arbiter must handle the variable-cardinality input; simpler input but couples arbiter logic to fan-out details.
  - **Recommend (A).** Keeps the arbiter interface cardinality-stable (`AgentVerdict[]` always has the expected verifier kinds); failure becomes data, not control-flow.

- **Open question — Cost trip-wire trigger metric.**
  - **(A) Sum of `modelLatencyMs` over the rolling window** — proxy for actual cost; no per-token billing data needed.
  - **(B) Sum of `usage.total_tokens` from `LlmClient.usage`** — actual token count; needs the OpenAI SDK's compat-layer usage to be present (Gemini compat layer may or may not return it — verify before locking).
  - **(C) Sum of (`modelLatencyMs` × `modelCostPerSecond`) per model** — most accurate; needs a hardcoded cost-per-model table.
  - **Recommend (B) if available, fallback to (A).** Verify in the smoke script that `LlmClient.usage` is populated by the Gemini compat layer; if not, use (A) and file (B) as a follow-up.

- **Open question — Coordination on `ProfileJob` schema between gate-enqueue and profiler-consume.**
  - **(A) Rename `BidVerificationRequest.pageUrl` → `url` OR rename `ProfileJob.pageUrl` → `url`** — pick one; consistency means one less footgun.
  - **(B) Add an alias in the queue write — gate constructs `{ url: bid.pageUrl, ... }` and profiler reads `job.pageUrl`.** Aliases hide the mismatch.
  - **(C) Leave both names; ESLint rule warns on `bid.url` typo.** Doesn't actually help.
  - **Recommend (A) with `pageUrl` as the canonical name.** `pageUrl` is more specific (distinguishes from `creativeRef.url` or `evidenceRef.uri`). Gate's enqueue line in `features/clusterA/gate-verdict-logic.md:24-26` is currently informal; lock it on this PRP's `ProfileJob.pageUrl` name.

- **Open question — Tenant-scoped evidence URI rewriting.**
  - **(A) Profiler rewrites at commit time** — harness emits namespace-less URIs (`features/clusterB/harness-capture-page.md:135-140`); profiler prefixes with `evidence/{advertiserId}/` before persisting. **Recommend.**
  - **(B) Harness takes `advertiserId` at capture-time** — couples harness to advertiser context (harness PRP explicitly *avoided* this at `features/clusterB/harness-capture-page.md:150`).
  - **(C) Dashboard tenant-filters on read** — defense in depth, but if read-side is the *only* check, a leak is one bug away.
  - **Recommend (A) + (C) as belt-and-suspenders.** Profiler rewrites; dashboard also tenant-filters by advertiser on the read side.

- **Security guardrails:**
  - **No `openai` or `@google/genai` import in `packages/profiler/**`.** Foundation ESLint rule (`PRPs/foundation-ad-verification.md:151-154`) blocks it. The Lobster Trap seam is preserved by *not introducing* a bypass here; verifiers receive their `LlmClient` instance, profiler never instantiates one.
  - **Tenant scoping on `ProfileStore.put`**: `(advertiserId, contentHash)` key; never accidentally `contentHash` alone. A profile committed without an `advertiserId` is a cross-tenant leak waiting to happen.
  - **Tenant scoping on evidence URIs**: every `EvidenceRef.uri` prefixed with `evidence/{advertiserId}/`. Asserted by a test that hand-builds a cross-advertiser scenario and proves the URIs disjoint.
  - **No raw page DOM in logs.** `capture.domText` is up to 256 KiB of arbitrary page content (`features/clusterB/harness-capture-page.md:21`) — never `console.log(capture)` or `logger.info({ capture })`. Log structured summaries (`{ url, contentHash, modes: [...], elapsedMs }`). The harness PRP made the same point at `features/clusterB/harness-capture-page.md:166`; reiterate here because profiler is the package most tempted to log the whole capture.
  - **No `GEMINI_API_KEY` in `packages/profiler/**`** — only `@scout/llm-client/src/config.ts` reads it (`PRPs/foundation-ad-verification.md:209-213`). The profiler's `config.ts` reads `PROFILER_CONCURRENCY`, `PROFILER_VERIFIER_TIMEOUT_MS`, the cost-window envs, and the TTL constants — and nothing else. Foundation's repo-wide `process.env.*` rule (`PRPs/foundation-ad-verification.md:301`) is preserved.
  - **No `BROWSER_USE_API_KEY` in `packages/profiler/**`** — same rule, but routed via `@scout/harness/src/config.ts`. Profiler instantiates `createHarness()` and never touches the env directly.
  - **Tenant isolation in the queue.** A consumer with `advertiserId: A` filter (if multi-tenant queues are later introduced) MUST NOT see `advertiserId: B` jobs. v1's single-queue design means all jobs share a stream; the profiler MUST NOT log `job.advertiserId` cross-referenced with `job.pageUrl` in a way that exposes one advertiser's prospect list to dashboard viewers of another (the audit row is per-advertiser, the queue-position log is not — pin this distinction in the logger config).
  - **No cookie/session state crosses jobs.** This is a harness property (`features/clusterB/harness-capture-page.md:152`), but profiler MUST NOT add session-pooling for cost reasons — a pooled session that captures advertiser A's request and then advertiser B's request leaks state across tenants. Each job → fresh `harness.capturePage` call.
  - **No silent ALLOW on warm-path failure.** A profile that fails to commit must NOT be readable as an ALLOW from the gate. The committed `PageProfile`'s `categories[]` are populated by the *arbiter's* consensus; an empty `categories[]` (because all verifiers failed) means the policy match sees no signals, which *defaults to `policy.escalation.ambiguousAction`* (per `features/clusterA/policy-match-evaluation.md:32`) — an advertiser whose `ambiguousAction = ALLOW` gets ALLOW'd against a verifier-blackout. **Mitigation**: when arbiter reports `humanReviewRecommended: true` (because all verifiers failed), commit a *sentinel* `PageProfile` with `categories: [{ label: "verifier_blackout", confidence: 1.0 }]` so any policy with a `category` rule on `verifier_blackout` can DENY. The default `permissive-baseline` fixture (`features/clusterA/policy-match-evaluation.md:38`) should include this rule. **Coordinate with the policy-fixtures PRP** — file the rule addition as a follow-up referenced from there.

- **Gotchas:**
  - **At-least-once delivery is a guarantee, not a complaint.** Redis Streams (and every reasonable production queue) deliver each message *at least once*; the consumer is responsible for idempotency. The `processedJobIds` LRU is the dedupe; without it, a Stream consumer rebalance triggers a full re-capture + re-fanout on every reclaimed message. This is not theoretical: `XAUTOCLAIM` is the recovery path Redis docs recommend for stuck consumers, and it *will* re-deliver.
  - **`processedJobIds` LRU is per-process.** A multi-process deployment will re-dedupe on each process; the dedupe property holds *within* a process between consumer-group rebalances but not *across* a deploy. v1 is single-process; document the upgrade path (move the dedupe set to Redis with a `SETNX` + TTL) as a follow-up.
  - **`AbortController` propagation through Promise chains is manual.** `verifier.verify(cap, { abortSignal })` MUST plumb the signal into `LlmClient.chat({ signal })`; if a verifier ignores the signal, the timeout test silently passes (because the timeout fires before the verifier completes) but the underlying SDK call still runs to completion and bills tokens. Test asserts: when `abort` fires at T+100ms, the spied `LlmClient.chat` mock receives a `signal.aborted === true` within 10ms.
  - **`Promise.allSettled` does NOT cancel pending promises on the first failure.** Each verifier's `AbortController` is independent — the per-verifier timeout fires independently per verifier. Don't try to abort all on first failure; that would be `Promise.race` over a sentinel, which `allSettled` is explicitly not.
  - **`processedJobIds` LRU eviction.** A job re-delivered after the LRU evicts its ID re-captures. With 4 concurrent jobs and a 1024-entry LRU, this happens after ~256× the steady-state job rate. Document the rule of thumb: `PROFILER_PROCESSED_LRU_SIZE` should be ≥ 4× the expected peak-hour job count.
  - **`ulid` library has multiple npm packages with similar names.** `ulid`, `ulidx`, `id128`. Pin the original `ulid` (Apache-2.0); verify no transitive dep already pulls a different one in.
  - **Redis Streams visibility timeout.** Set it to *significantly more than the longest expected job duration* (8s harness P95 from `features/clusterB/harness-capture-page.md:46` + 30s verifier timeout per-verifier in worst-case sequential failover ≈ ≤ 100s end-to-end). Default `PROFILER_VISIBILITY_TIMEOUT_MS ?? 120000` (2 min). Too short: jobs reclaim mid-execution and re-deliver to a sibling worker (double-spend on Gemini Pro). Too long: a crashed worker holds a job for the timeout duration before another picks it up.
  - **Pinned Lobster Trap trace ID chain.** The audit row's `lobstertrapTraceIds: [text, image, video, arbiter]` is in *fixed verifier order*, not call-completion order — otherwise the dashboard's per-call drill-down sees jitter. Order at write-time by verifier kind enum order (`["text", "image", "video", "arbiter"]`).
  - **Foundation's `agent-*` stubs return a *fixed* `AgentVerdict`.** When this PRP upgrades them to `Verifier`-typed factories, the body still returns the same fixed value — tests that assume verifier output varies by `capture.url` will silently pass against the stub and fail against real prompts. Make tests assert *interface shape and call patterns*, not verdict content.
  - **`degradationHint: "collapse_text_image"` is observable, not implemented here.** The combined-modality verifier is out of scope; the hint is wired, and a `verifiers.combined` slot exists on `ProfilerDeps`, but the foundation does not provide a combined-verifier stub. **Profiler throws at `createProfiler` if `combined` is missing AND the hint is set on a job.** This fails loud rather than silently invoking 3 separate verifiers (which would defeat the cost saving the hint exists for).
  - **`PageCapture` size on the wire.** `capture.domText` is up to 256 KiB + `screenshots[]` references to base64 data URIs (per the harness's open question (C) at `features/clusterB/harness-capture-page.md:137-138`) can balloon a single capture past 5 MiB. The profiler does NOT serialize `PageCapture` to Redis; it processes it in-memory, persists only `PageProfile` (a small structured object) + `EvidenceRef.uri[]`. If the harness PRP locked option (C) for storage URIs, this PRP MUST translate them to (A) `file://`-or-equivalent before commit; persisting base64 data URIs into Redis exhausts the cache budget in minutes.
  - **`vi.useFakeTimers` + Redis** — the integration test against in-memory `ProfileQueue` can use fake timers; against a real ioredis (even ioredis-mock), DO NOT mix fake timers with `await redis.xreadgroup` — the underlying `socket.setTimeout` interacts badly. Keep the cost-tripwire test on the in-memory rig.
  - **`logger` interface mismatch.** Foundation lands a `Logger` interface somewhere (`PRPs/foundation-ad-verification.md:238` lists `shared/src/env.ts` + `result.ts`; logger is NOT listed). Choose: (i) Use `console.*` with structured-JSON formatting and document upgrade-path; (ii) add a `Logger` interface to `@scout/shared` here; (iii) require the dashboard's logger to be passed in. **Recommend (ii)** — adds 10 lines, makes the verifier audit-row format testable. But verify foundation didn't already land one before duplicating.

- **Out of scope — file as follow-ups:**
  - **Real verifier prompts** (`agent-text-verifier-prompt.md`, `agent-image-verifier-prompt.md`, `agent-video-verifier-prompt.md`). This PRP locks the `Verifier` interface; the prompts implement against it.
  - **Real arbiter scoring** (`agent-arbiter-scoring.md`). This PRP locks the `Arbiter` interface; arbiter scoring implements `combine()` for real (disagreement detection, confidence blending, evidence assembly).
  - **Combined text+image verifier** (the `"collapse_text_image"` degradation target). The hint is wired; the implementation is filed.
  - **Multi-process `processedJobIds` dedupe** (move to Redis `SETNX`-with-TTL). v1 is single-process.
  - **Real Redis Streams `ProfileQueue` impl beyond the in-memory** — needs verification against a live ioredis-mock test. The interface is locked here; the impl can ship in a follow-up if the in-memory passes the integration test and the demo doesn't need persistent queue state across restarts.
  - **Cost-tripwire calibration** — `PROFILER_COST_WINDOW_SOFT` / `_HARD` defaults need to be set by measuring the smoke script against the demo bidstream's fixtures (`FEATURE-TODO.md:79-82`). v1 ships generous defaults (effectively never trips) and the demo seeding PRP can tune them.
  - **`Policy.escalation.ttlOverride`** per-advertiser TTL — requires a `PolicySchema` re-lock; file referenced from `features/clusterA/policy-match-evaluation.md:108-111`.
  - **Per-advertiser queue isolation** (separate streams per `advertiserId` for rate-limit fairness). v1 shares a stream; fairness is the gate's `RATE_LIMIT` rule's job.
  - **`creativeTags` on `PageProfile`** — out of profiler scope (creative tags describe the advertiser's creative, not the destination page). Same out-of-scope note as `features/clusterB/harness-capture-page.md:171-172`.
  - **Verifier-output caching** (a verifier asked the same question twice on the same `(contentHash, taxonomy)` returns the cached result). Would cut warm-path Pro spend ~3× on demo replays; complicates the audit-trace chain (a cached call has no trace ID); deferred.
  - **`ProfileStore` Redis impl beyond memory** — foundation lands it (`PRPs/foundation-ad-verification.md:243-245`); profiler is a consumer, not a writer of the impl.
  - **Sentinel `verifier_blackout` rule in baseline policy fixtures** — coordinate with whoever owns `packages/policy/fixtures/permissive-baseline.json`; file from this PRP, land in the policy-match PRP (which already owns those fixtures).

- **Test order:**
  1. `ProfileJobSchema` + `AgentVerdictSchema` + `ArbiterDecisionSchema` shape tests first (no `runProfiler` call; pins the contracts; lets every later test rely on `parse()`).
  2. `Verifier`, `Arbiter`, `ProfileQueue` interface compile-tests (`satisfies` assertions on the upgraded foundation stubs).
  3. In-memory `ProfileQueue` impl: enqueue + consume + ack + nack round-trip (smallest pipeline; proves the queue interface before any consumer logic).
  4. Single-job happy path against an all-stubs `ProfilerDeps` (proves the fanout + commit wiring).
  5. Idempotent re-delivery (LRU short-circuit; same `job.id` twice).
  6. Bounded concurrency (10 jobs, `PROFILER_CONCURRENCY=4`; counter assertion).
  7. Partial-verifier-failure matrix (one rejects, two-of-three; verifies arbiter input shape).
  8. Per-verifier timeout (`vi.useFakeTimers`, `AbortSignal` plumbing assertion).
  9. Harness-failure-classification matrix (capture throws different `HarnessError` values; nack/poison routing).
  10. TTL heuristic table (`test.each` over `(host, ogType)` matrix).
  11. Cost-tripwire transition matrix (`vi.useFakeTimers` advances the rolling-window clock).
  12. `degradationHint` floor semantic (job-level vs. window-cost, never downgrade).
  13. Tenant-scoped evidence URI rewrite (cross-advertiser disjointness).
  14. Graceful-shutdown mid-job (in-flight job nack'd, no `ack` on shutdown).
  15. Audit row trace-ID-chain completeness (4 non-null trace IDs on a happy non-degraded job; sentinel null on a degraded one).
  16. Integration test against the in-memory rig (5 jobs end-to-end; bounded time + LRU + commit count).
  17. Smoke script (manual; not in `pnpm test`; runs against real `GEMINI_API_KEY` + real Lobster Trap proxy + the demo bidstream's first fixture). Last because it's the only test that consumes a quota AND requires the harness PRP to have landed.
