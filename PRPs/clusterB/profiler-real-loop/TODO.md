# profiler-real-loop — PRP progress tracker

> Five-PRP split of `features/clusterB/profiler-real-loop.md`. Each PRP is
> commit-sized for a single Claude Code session, ordered by dependency.
> Tick the box when the PRP's full validation sweep is green AND the PR
> lands on `main`.

Cluster output total: **1956 lines** across 5 PRPs (303 source feature
file × ~6.5× expansion). Each PRP capped at 400 lines.

## Order (each PRP blocks the next)

- [x] **PRP-A — `profiler-contracts.md`** (400 lines, confidence 9/10)
      → `PRPs/clusterB/profiler-real-loop/profiler-contracts.md`
      Lands `ProfileJob` + `AgentVerdict` + `ArbiterDecision` schemas
      and `Verifier` + `Arbiter` + `ProfileQueue` interfaces in
      `@scout/shared`. Upgrades the four `packages/agents/*/src/index.ts`
      stubs from `export {};` to `Verifier`/`Arbiter`-typed factories
      with hardcoded valid bodies.
      *Blocks:* PRP-B, PRP-C, PRP-D, PRP-E, and every Cluster C
      verifier-prompt PRP.
      *Validation gate:* `pnpm --filter @scout/shared test` + `pnpm -r
      exec tsc --noEmit` green.

- [x] **PRP-B — `profiler-in-memory-queue.md`** (394 lines, confidence 8/10)
      → `PRPs/clusterB/profiler-real-loop/profiler-in-memory-queue.md`
      Lands `InMemoryProfileQueue` in `@scout/store` — enqueue / consume
      (`AsyncIterableIterator`) / ack / nack / visibility-timeout reclaim
      / abort-signal drain / DLQ.
      *Prereq:* PRP-A merged (imports `ProfileQueue`, `NackReason`,
      `ProfileJob` from `@scout/shared`).
      *Validation gate:* `pnpm --filter @scout/store test` green.

- [x] **PRP-C — `profiler-core-loop.md`** (400 lines, confidence 7/10)
      → `PRPs/clusterB/profiler-real-loop/profiler-core-loop.md`
      Lands `createProfiler` + `runProfiler` + `fanout.ts` + `commit.ts`
      + a minimal `Logger` interface in `@scout/shared`. Wires bounded
      concurrency, partial-failure `Promise.allSettled` fanout, per-verifier
      `AbortController` timeout, idempotent re-delivery via a process-local
      LRU, `PageProfile` assembly, and an interim opaque audit row.
      Does **not** yet do tenant URI rewrite, cost-tripwire, TTL heuristic,
      retry/DLQ classification, or full graceful shutdown — those are
      PRP-D and PRP-E.
      *Prereqs:* PRP-A + PRP-B merged.
      *Validation gate:* `pnpm --filter @scout/profiler test` green, full
      hot-path / warm-path ESLint boundary still passes.

- [x] **PRP-D — `profiler-cost-ttl-retry.md`** (380 lines, confidence 8/10)
      → `PRPs/clusterB/profiler-real-loop/profiler-cost-ttl-retry.md`
      Lands `costTripwire.ts` (rolling-window degradation) + `ttlPolicy.ts`
      (host + og-type TTL heuristic) + `retry.ts` (`classifyError` +
      `computeRetryAt` exponential backoff + DLQ audit). Edits `commit.ts`
      to swap the hardcoded TTL, and `runProfiler.ts` to thread the hint +
      classified nack reason + sentinel `verifier_blackout`.
      *Prereqs:* PRP-A + PRP-C merged.
      *Validation gate:* `pnpm --filter @scout/profiler test` green
      including the fake-timer cost-window + TTL `test.each` matrices.

- [x] **PRP-E — `profiler-tenant-shutdown-smoke.md`** (382 lines,
      confidence 8/10)
      → `PRPs/clusterB/profiler-real-loop/profiler-tenant-shutdown-smoke.md`
      Lands `rewriteEvidenceUri()` (tenant scoping at commit time),
      full structured `AuditRow` schema, graceful-shutdown polish in
      `runProfiler.ts` (`PROFILER_SHUTDOWN_GRACE_MS=30000` + hard-kill
      cap, no-`ack`-on-shutdown), the 5-job integration test, and the
      `pnpm --filter @scout/profiler run smoke` smoke script against
      real Cloud + Lobster Trap + Gemini.
      *Prereqs:* PRP-A + PRP-B + PRP-C + PRP-D merged.
      *Validation gate:* full `pnpm -r exec tsc --noEmit && pnpm -r
      test && pnpm -r build && pnpm audit` green, plus one manual
      `smoke` run with `GEMINI_API_KEY` + Lobster Trap up.

## Update protocol

When a PRP's validation gate is green AND the PR is merged:
1. Tick the box above.
2. Cross-check the cluster-wide coordination flags below; if any was
   resolved by that merge, strike through here.
3. After PRP-E ships, tick the `features/clusterB/profiler-real-loop.md`
   row in `FEATURE-TODO.md` (per
   `.claude/memory/feedback_feature_todo_tick_convention.md`: `[x]`
   means feature file drafted; mark separately if you also want a
   PRP-cluster-complete signal).

## Cross-PRP coordination — resolve before the named PRP lands

These came out of the five parallel drafts. Each is small but a silent
mismatch will cost a one-commit fix downstream.

### 1. `InMemoryProfileQueue` constructor shape *(blocks PRP-C)*

- **PRP-B** exports a class: `new InMemoryProfileQueue()`.
- **PRP-C** Task 3 cites `createMemoryProfileQueue()` (factory function).

Pick one before PRP-C is implemented. The class form is simpler and
matches the Redis-impl follow-up's likely shape; the factory form is
consistent with `createHarness()` / `createLlmClient()` / `createProfiler()`
elsewhere in the codebase. **Recommend the factory form** for
consistency; if so, update `PRPs/clusterB/profiler-real-loop/profiler-in-memory-queue.md`
§ Target contract + Task 2 (one-line rename, `export function
createMemoryProfileQueue(): ProfileQueue { return new InMemoryProfileQueue(); }`
plus keep the class exported for `instanceof` tests).

### 2. `combined` verifier missing-guard placement *(blocks PRP-D)*

Feature file is ambiguous — line 127 says "throws at `createProfiler`
time", line 265 says "fail-loud at construction".

- **PRP-C** D1: marks `combined` optional; PRP-D enforces throw **at
  `createProfiler`**.
- **PRP-D** § 134–136: enforces throw **at job-time** (worker dispatch),
  citing feature line 265's "missing-combined guard is at job-time".

Pick one. **Construction-time** is safer (fails before any job runs;
no per-job latency overhead; clearer error stack) — but only useful if
the static dep set actually reflects which hints will arrive. **Job-time**
matches the case where a small subset of jobs request `collapse_text_image`
while most don't (the dep absence shouldn't crash the whole worker).
Given the cost-tripwire can *promote* a job into `collapse_text_image`
in-flight (PRP-D's window-cost driver), **job-time is the only
self-consistent option** — construction-time would crash a worker that
was started with `combined` absent but had the trip-wire promote a job
later. Recommend keeping PRP-D's job-time choice and updating PRP-C's
D1 row before PRP-D lands.

### 3. `pageUrl` vs `url` field name on `ProfileJob` *(blocks gate PRP next pass)*

PRP-A D1 locks `ProfileJob.pageUrl` as canonical. Gate's enqueue
(`features/clusterA/gate-verdict-logic.md:24-26`) currently writes
`{ url, advertiserId, policyId }` informally. **Not blocking any
profiler PRP** — the schema in `@scout/shared` is authoritative; gate's
own PRP next pass will align. Flagged here for the gate PRP author to
pick up.

### 4. `AuditRow` structured schema lock *(handed off PRP-C → PRP-E)*

PRP-C writes audit rows with an interim opaque shape (`row: unknown`)
because foundation never landed `AuditRowSchema`. PRP-E locks the full
schema (`{ advertiserId, jobId, profileId?, lobstertrapTraceIds,
decisionPath, elapsedMs, ... }`). **Resolution:** PRP-E's first task
should add `AuditRowSchema` to `@scout/shared` and migrate PRP-C/PRP-D's
ad-hoc rows. Already in PRP-E's task list; flagged here so reviewers
don't ask why PRP-C ships with an opaque type.

### 5. `Logger` interface placement *(resolved — PRP-C owns)*

PRP-C-D6 lands `Logger` in `@scout/shared/src/interfaces/logger.ts`
(8-line interface, foundation never landed one). PRP-D-D9 consumes
without redefining. **No action.**

### 6. `permissive-baseline.json` sentinel rule *(follow-up, NOT a profiler PRP)*

PRP-D's sentinel `verifier_blackout` category lands in `PageProfile`
when 2+ verifiers fail. For it to actually deny, a matching rule must
exist in the baseline policy fixture
`packages/policy/fixtures/permissive-baseline.json`. Owner: the
`policy-match-evaluation.md` PRP (Cluster A). File the ask in that
PRP's follow-up list — do not edit the fixture from any profiler PRP.

## Per-PRP confidence (self-rated)

| PRP | Lines | Confidence | Risk |
|---|---|---|---|
| A — contracts | 400 | 9/10 | Greenfield schemas in a well-precedented package; only risk is the `pageUrl` rename coordination with gate. |
| B — queue | 394 | 8/10 | Wait-for-work resolver triple-wakeup is subtle; PRP's Task 7 catches deadlock case via TDD. |
| C — core loop | 400 | 7/10 | Densest PRP; downstream type drift from A/B is the largest risk. |
| D — cost / TTL / retry | 380 | 8/10 | Pure-logic; sentinel-blackout threshold judgment may need revisit after Cluster C arbiter scoring lands. |
| E — tenant / shutdown / smoke | 382 | 8/10 | Most-coordinated PRP (three edit call-sites into C+D); `stop()` semantic is subtle but well-tested. |

## Done criteria for the cluster

- [ ] All 5 PRPs ticked above.
- [ ] `features/clusterB/profiler-real-loop.md` ticked in `FEATURE-TODO.md`.
- [ ] At least one `pnpm --filter @scout/profiler run smoke` run on a
      machine with `GEMINI_API_KEY` + a running Lobster Trap proxy,
      output captured in the PR description (per feature line 138 —
      the demo's full warm-path chain must not be first-touched on
      demo day).
- [ ] `CLAUDE.md § Stack` updated with: profiler concurrency default
      (4), verifier-timeout default (30s), TTL heuristic defaults, cost
      window defaults, audit-row schema, shutdown grace. (Cluster's
      locked decisions, per § Update protocol.)
- [ ] Foundation ESLint boundary check still passes:
      `packages/profiler/**` does not import `openai` or
      `@google/genai`; `packages/gate/**` does not import
      `@scout/profiler`.
- [ ] Two follow-up tickets filed: (a) Redis Streams `ProfileQueue`
      impl, (b) `verifier_blackout` rule in
      `packages/policy/fixtures/permissive-baseline.json`.
