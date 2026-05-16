name: "Profiler — PRP-B: `InMemoryProfileQueue` in `@scout/store` (TDD)"
description: |

  Second of five PRPs implementing `features/clusterB/profiler-real-loop.md`.
  Lands the in-memory concrete impl of the `ProfileQueue` interface
  (defined in PRP-A) inside `@scout/store`.

  **Prereq**: PRP-A (`PRPs/clusterB/profiler-real-loop/profiler-contracts.md`)
  merged — this PRP imports `ProfileJob`, `ProfileQueue`, `NackReason`
  from `@scout/shared`. Do NOT redefine those types here.

  **Consumed by**: PRP-C (`runProfiler` integration test + smoke uses
  this in-memory rig), PRP-D (fanout + commit helpers wire against
  the same `ProfileQueue` shape), PRP-E (cost-tripwire + tenant-scoped
  evidence URI rewrite — orthogonal, but lands on top).

  Out of scope here: `runProfiler` (PRP-C), real Redis Streams impl
  (filed below), multi-process dedupe set, per-tenant queue isolation.

  ## TDD discipline

  **Red → Green → Refactor.** Write the test first; run it; confirm
  it fails for the expected reason. Write the minimum impl. Then
  tidy. Commit at green; never at red unless the message reads
  `WIP — red`. Pure in-memory data structure; every test is
  deterministic with `vi.useFakeTimers` where time is involved.

  ## Why this PRP exists separately

  - **PRP-C's integration test depends on it.** Without a real
    `ProfileQueue` impl, the warm-path round-trip test stubs the
    queue and never exercises ack / nack / visibility-timeout
    reclaim. Splitting makes the queue contract a testable seam.
  - **Standalone-testable.** No verifiers, no harness, no LLM —
    pure data-structure tests. One commit-sized PR.
  - **Production Redis Streams impl follows.** Same `ProfileQueue`
    interface; ioredis swap is one new file + factory toggle. Filed
    in *Out of scope*; in-memory is what tests and demo use.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A. Warm-path; gate's ESLint boundary
    (`PRPs/foundation-ad-verification.md:157-159`) blocks
    `packages/gate/**` from importing `@scout/store` queue exports.
  - **Pre-bid** — Honored by placement. Gate enqueues only
    (`features/clusterA/gate-verdict-logic.md:24-26`); profiler
    consumes.
  - **Plug-and-play** — The `ProfileQueue` interface IS the seam.
    Redis Streams impl swaps in with no consumer change.
  - **Sponsor tech** — Neither directly. Queue is policy-free wire;
    Lobster Trap routes verifier→LLM calls flowing *on* the jobs
    (PRP-C's concern). Gemini doesn't enter here.

  ## Prereq — PRP-A merged

  This PRP imports:

  ```ts
  import type { ProfileJob, ProfileQueue, NackReason } from "@scout/shared";
  ```

  Those three names land in `@scout/shared` via PRP-A. If PRP-A is
  not on the branch, **block on its merge** — do not duplicate the
  types here. PRP-A's "Target contracts" section is the authoritative
  source; this PRP is the consumer.

  ## CLAUDE.md rules that bite

  - § Working agreements — **"Ask before adding a dependency."** Zero
    new runtime deps. `vitest` is in workspace devDeps; impl uses
    Node stdlib (`AbortSignal`, `setTimeout`) only.
  - § Stack — TypeScript strict, NodeNext, ES2022, ESM-only.
  - 300-line file cap; tests colocated as `*.test.ts`.

  ## Decisions (locked here)

  | # | Question | Locked answer | Why |
  |---|---|---|---|
  | D1 | Visibility-timeout reclaim | **Lazy.** Scan in-flight map on every `next()`; reclaim entries where `(now − leasedAt) > visibilityTimeoutMs` before yielding pending. | Avoids per-tuple timers (GC-unfriendly, hostile to fake timers). Matches Redis Streams `XAUTOCLAIM` (pull-on-poll). |
  | D2 | `ack()` after `nack()` | **Throws** `Error("ack after nack on job <id>")`. | Silent no-op masks a consumer bug where ack and nack both fire. |
  | D3 | Double-`ack()` | **Throws** `Error("double ack on job <id>")`. | Same reasoning as D2. Tuple is single-use. |
  | D4 | Reclaimed-tuple's original `ack`/`nack` | **Throws** `Error("tuple expired (visibility timeout reclaimed)")`. | Ack-ing the old tuple after the reclaim re-delivered would corrupt in-flight state. Fail loud. |
  | D5 | `retryAt` in past / absent | Re-deliver on the **next** iteration (no wait). | `retryAt` is *scheduled-not-blocking*; queue's job is delivery, not sleeping. |
  | D6 | `getDLQ()` shape | `readonly ProfileJob[]` (shallow-copied snapshot). | Caller cannot mutate internal state; auditing is read-only. |
  | D7 | Abort signal | Next `next()` resolves with `{ done: true }`. **Do not throw** `AbortError`. Second `consume()` call still works. | Async-iterator protocol; matches `browserMode.abort.test.ts`. |
  | D8 | `attempt` increment | Incremented on the *delivered copy* (not stored job) for both `nack(transient)` and visibility-timeout reclaim. | At-least-once; `attempt` reflects delivery count from consumer's view. |
  | D9 | FIFO vs. priority | **FIFO only** for v1. `retryAt`-due re-delivers go to head of pending. | Redis Streams impl can layer priority later. |
  | D10 | Job copy on re-deliver | **Shallow** `{ ...job, attempt: job.attempt + 1 }`. | `ProfileJob` is flat per PRP-A schema; no `structuredClone` cost. |

  ## All Needed Context

  ```yaml
  - file: PRPs/clusterB/profiler-real-loop/profiler-contracts.md
    why: PRP-A. Source of ProfileJob / ProfileQueue / NackReason types.
      Imported, not redefined.

  - file: features/clusterB/profiler-real-loop.md
    section: "ProfileQueue interface (line 71); idempotency note
      (lines 105-107, NOT this PRP — PRP-C concern); test order
      (lines 113-115); production-impl open question (lines 192-196)."
    why: Source spec. Line 71 is the interface this PRP implements.

  - file: PRPs/clusterB/harness-browser-helpers.md
    why: Structural precedent — pure-helper PRP with TDD task list,
      decisions table, target contracts inline. Copy structure, not
      content.

  - file: packages/store/src/index.ts
    why: Currently `export {};`. This PRP appends one `export *`.

  - file: packages/store/package.json
    why: Workspace dep on @scout/shared already present. No new deps.

  - file: packages/harness/src/__tests__/browserMode.abort.test.ts
    why: Precedent for AbortController + AsyncIterator interaction.
      Same `done: true` semantic for signal-fired iteration.

  - file: PRPs/foundation-ad-verification.md
    section: "lines 26, 113, 243-245 — store package is foundation-
      owned for memory + redis + sqlite impls."
    why: Style match. ProfileStore / PolicyStore / AuditStore land
      here too (may or may not be present at this PRP's merge time).

  - url: https://redis.io/docs/latest/develop/data-types/streams/#consumer-groups
    why: Visibility-timeout semantics — XAUTOCLAIM is the production
      analogue for D1's lazy reclaim. In-memory mirrors the contract.

  - url: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
    why: AbortSignal event listener pattern for D7. The signal can
      fire before or during `next()`.

  - url: https://vitest.dev/api/vi.html#vi-usefaketimers
    why: Fake timers for D5 (retryAt scheduling) and visibility-
      timeout reclaim test. Feature-file gotcha line 267 says fake
      timers + ioredis don't mix; in-memory is fine.
  ```

  ## Files to create / modify

  Create:
  - `packages/store/src/inMemoryProfileQueue.ts` — impl (≤200 lines).
  - `packages/store/src/__tests__/inMemoryProfileQueue.test.ts` — tests.

  Modify:
  - `packages/store/src/index.ts` — append `export * from
    "./inMemoryProfileQueue.js";`. If foundation task 4
    (`ProfileStore`+`PolicyStore`+`AuditStore`) has landed, leave
    those exports intact; otherwise note them as
    pre-existing-or-pending in a comment.

  No `package.json` changes — no new runtime deps.

  ## Target contract — `InMemoryProfileQueue` skeleton

  ```ts
  import type { ProfileJob, ProfileQueue, NackReason } from "@scout/shared";

  interface LeaseState {
    job: ProfileJob;
    leasedAt: number;
    settled: boolean;
  }

  export class InMemoryProfileQueue implements ProfileQueue {
    private pending: ProfileJob[] = [];                              // FIFO
    private inFlight = new Map<string, LeaseState>();                // by leaseId
    private scheduled: { job: ProfileJob; releaseAt: number }[] = [];
    private dlq: ProfileJob[] = [];
    private leaseCounter = 0;
    private pendingResolver: (() => void) | null = null;
    private clock: () => number;

    constructor(opts?: { clock?: () => number }) {
      this.clock = opts?.clock ?? Date.now;
    }

    async enqueue(job: ProfileJob): Promise<void> {
      this.pending.push(job);
      this.pendingResolver?.();
    }

    consume(opts: {
      signal: AbortSignal;
      visibilityTimeoutMs: number;
    }): AsyncIterableIterator<{
      job: ProfileJob;
      ack(): Promise<void>;
      nack(reason: NackReason): Promise<void>;
    }> {
      // Returns { [Symbol.asyncIterator]() { return this; }, next() }.
      // next() loop:
      //   1. If signal.aborted → { done: true }.
      //   2. Drain scheduled[] where releaseAt <= now → unshift pending.
      //   3. Reclaim inFlight where (now - leasedAt) > visibilityTimeoutMs:
      //      lease.settled = true; unshift { ...job, attempt+1 } to pending.
      //   4. If pending empty AND no scheduled item due soon: await a Promise
      //      that resolves on enqueue, on abort, or on setTimeout(timeUntilDue).
      //   5. Shift pending[0]; mint leaseId; record LeaseState; build tuple.
      //   6. ack/nack closures check lease.settled; throw per D2/D3/D4.
      //      nack(transient): push to scheduled with releaseAt =
      //        max(now, Date.parse(retryAt ?? "")). NaN/absent → now.
      //      nack(poison): push original job (not the +1 copy) to dlq.
      return /* iterator object per above */;
    }

    /** D6: shallow-copied snapshot. */
    getDLQ(): readonly ProfileJob[] {
      return [...this.dlq];
    }
  }
  ```

  > **Implementer note**: the wait-for-work mechanism is the non-trivial
  > bit. Use one `pendingResolver` field; `enqueue` calls it if set;
  > `next()` awaits `new Promise(r => { pendingResolver = r;
  > signal.addEventListener("abort", r, { once: true }); const t =
  > setTimeout(r, timeUntilNextScheduled); cleanup clears both. })`.
  > Without the `setTimeout`, a transient-nack with future `retryAt`
  > deadlocks when pending is otherwise empty.

  ## Task order (TDD; commit-sized)

  ### Task 1 — Red→Green: barrel + import smoke

  **Red.** `import { InMemoryProfileQueue } from "@scout/store"` in
  the test; `expect(new InMemoryProfileQueue()).toBeInstanceOf(...)`.
  Runs → red (no exported member).

  **Green.** Add empty class shell + `export *` in barrel.

  ### Task 2 — Red→Green: happy enqueue/consume/ack

  **Red.** Enqueue 1 valid `ProfileJob`; `consume({ signal,
  visibilityTimeoutMs: 60_000 })`; first iteration yields tuple
  whose `job.id` matches; `ack()`; a second iteration (with
  short-timeout `controller.abort()`) returns `{ done: true }`.

  **Green.** Implement `enqueue` (push), `next()` (shift pending,
  build tuple), `ack` (delete from `inFlight`).

  ### Task 3 — Red→Green: FIFO order

  **Red.** Enqueue 3 jobs with distinct ids; consume yields in
  enqueue order. (Regression guard even if Task 2 implies it.)

  ### Task 4 — Red→Green: `nack(transient)` re-delivers

  **Red.** Enqueue 1; consume yields it; `nack({ kind: "transient",
  detail: "x" })`; next iteration yields the same `job.id` with
  `attempt: 2` (was 1).

  **Green.** `nack` pushes `{ ...job, attempt+1 }` to `scheduled`
  with `releaseAt = now()`. `next()` drains scheduled first.

  ### Task 5 — Red→Green: `nack(poison)` DLQs

  **Red.** Enqueue 1; consume yields it; `nack({ kind: "poison",
  detail: "bad job" })`; `getDLQ()` returns 1 job; next iteration
  with short-timeout abort returns `{ done: true }`.

  **Green.** Branch on `reason.kind`; poison → push to `dlq[]`.

  ### Task 6 — Red→Green: visibility-timeout reclaim

  **Red.** `vi.useFakeTimers()`. Enqueue 1; consume yields it; do
  NOT ack; `vi.advanceTimersByTime(visibilityTimeoutMs + 1)`; next
  iteration yields the same `job.id` with `attempt` incremented.

  **Green.** In `next()`, before shifting pending, scan `inFlight`:
  for any lease where `clock() - leasedAt > visibilityTimeoutMs`,
  set `lease.settled = true`, delete from map, unshift `{ ...job,
  attempt+1 }` to pending.

  ### Task 7 — Red→Green: abort signal → `{ done: true }`

  **Red.** Start `consume()`; on the empty-pending wait, call
  `controller.abort()`; awaited `next()` resolves `{ done: true,
  value: undefined }`. A second `consume()` with a fresh controller
  on the same queue still works (enqueue 1, yields it).

  **Green.** Attach `signal.addEventListener("abort", resolver, {
  once: true })` inside the wait-for-work promise. Queue retains
  state across consume calls.

  ### Task 8 — Red→Green: `ack` after `nack` throws (D2)

  **Red.** Tuple `t`; `t.nack(transient)`; `t.ack()` throws
  `/ack after nack/`.

  **Green.** Closure-captured `settled` flag; ack throws if set.

  ### Task 9 — Red→Green: double-`ack` throws (D3)

  **Red.** Tuple `t`; `t.ack()`; second `t.ack()` throws
  `/double ack/`.

  **Green.** Distinguish via closure state machine (track last
  transition kind for the error message).

  ### Task 10 — Red→Green: `nack(transient)` with past `retryAt`

  **Red.** `nack({ kind: "transient", detail: "x", retryAt:
  new Date(0).toISOString() })`; next iteration immediately yields
  the re-delivered copy. Proves `retryAt` is scheduled-not-blocking.

  **Green.** `releaseAt = max(now, Date.parse(retryAt) || now)`;
  drain logic already handles it.

  ### Task 11 — Red→Green: orphaned tuple after reclaim (D4)

  **Red.** `vi.useFakeTimers()`. Tuple `t1`; advance past
  `visibilityTimeoutMs`; next iteration yields `t2` (re-delivered);
  `t1.ack()` throws `/tuple expired/`.

  **Green.** During reclaim, set `lease.settled = true` (same flag
  ack/nack check). `t2` gets fresh lease.

  ### Task 12 — Validation sweep

  ```bash
  pnpm --filter @scout/store test
  pnpm -r exec tsc --noEmit
  pnpm -r build
  ```

  Assert: all green, no `any`/`@ts-ignore`, file ≤200 lines, no
  `process.env.*` access in this package.

  ## Validation gates

  - `pnpm --filter @scout/store test` — all green.
  - `pnpm -r exec tsc --noEmit` — no type errors (catches PRP-A drift).
  - `pnpm -r build` — clean.
  - `grep -rn 'process\.env' packages/store/src` — expected empty.

  ## Security guardrails

  - **No env access.** A future Redis Streams impl needing
    `REDIS_URL` puts it in `packages/store/src/config.ts` (single
    audit point per `PRPs/foundation-ad-verification.md:209-213`).
  - **In-memory only.** Jobs never leave the process. No network
    surface; no disk write. A crashed process loses pending +
    in-flight + DLQ — acceptable for v1 (single-process; integration
    test rebuilds on each run).
  - **No log of `job.advertiserId` × `job.pageUrl` here.** Tenancy
    cross-referencing in logs is PRP-C's concern; the queue is
    policy-free wire. Debug-log `{ id, attempt }` only.

  ## Out of scope (file as follow-ups)

  - **Redis Streams `ProfileQueue` impl** — `XADD` / `XREADGROUP` /
    `XACK` / `XAUTOCLAIM`. Same interface; new file
    `packages/store/src/redisProfileQueue.ts` + factory toggle.
    Foundation locked ioredis
    (`PRPs/foundation-ad-verification.md:26`); demo uses in-memory
    per feature-spec line 196.
  - **Multi-process dedupe set** — `processedJobIds` LRU is in the
    profiler (PRP-C), per-process. Redis `SETNX`-with-TTL is a
    follow-up (feature-spec line 257).
  - **Per-tenant queues** — separate FIFO per `advertiserId`. v1
    shares one queue; tenancy is in the payload, not the partition.
    Filed under PRP-E.
  - **Priority queues / aging** — FIFO only for v1.

  ## Anti-Patterns

  - Don't `setInterval` for visibility-timeout reclaim. Lazy scan on
    `next()` (D1, matches `XAUTOCLAIM`). Per-tuple timers fight
    `vi.useFakeTimers`.
  - Don't expose `pending` / `inFlight` / `scheduled` / `dlq` as
    public fields. `getDLQ()` is the only read; everything else
    internal.
  - Don't `throw` on abort. Async-iterator protocol is `{ done:
    true }`. Throwing breaks `for await` and contradicts D7 +
    `browserMode.abort.test.ts`.
  - Don't deep-clone with `structuredClone`. Shallow `{ ...job,
    attempt+1 }` is enough — `ProfileJob` is flat per PRP-A.
  - Don't leave `setTimeout` without matching `clearTimeout` on
    cleanup (abort, settle). Leaked timers keep Node alive past
    test end.
  - Don't mutate the in-FIFO `ProfileJob` for `attempt`. The
    delivered copy carries the new count (D8/D10).
  - Don't import from `packages/profiler/**` or
    `packages/harness/**`. The queue is a leaf.
  - Don't add a runtime dep. Stdlib + `@scout/shared` only.

  ## Confidence: 8 / 10

  Pure data structure with deterministic tests. The subtle bit is the
  **wait-for-enqueue + signal-abort + scheduled-release** triple
  (Tasks 7 + 11). A naive `while(true)` busy-loop passes happy tests
  and deadlocks abort. The single-resolver-plus-setTimeout pattern
  in *Implementer note* threads all three; TDD catches the deadlock
  at Task 7.
