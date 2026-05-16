name: "Profiler — PRP-A: contracts in `@scout/shared` + agent-stub upgrade (TDD)"
description: |

  First of five PRPs implementing `features/clusterB/profiler-real-loop.md`.
  Lands ONLY the warm-path contracts (`ProfileJob`, `AgentVerdict`,
  `ArbiterDecision`, `Verifier`, `Arbiter`, `ProfileQueue`) and upgrades
  the four agent stubs from `export {};` to interface-conformant
  factories. Source: feature file lines 13, 30–72, 113–116, 142–155. NO
  `runProfiler` body, NO queue impl, NO cost trip-wire, NO TTL, NO retry
  — those land in PRPs B–E.

  ## TDD discipline

  Every task is **red → green → refactor**: write the test first, confirm
  it fails for the *expected reason* (`TS2307`/`ERR_MODULE_NOT_FOUND` on
  imports, `TS2322` on `satisfies`), write minimum impl, refactor (`pnpm
  -r exec tsc --noEmit` + `eslint --fix`). Commit at green; never at red
  unless `WIP — red`. Wrong-reason red → fix the test, not the impl.
  Schemas tempt "just type it out" — four downstream PRPs consume these
  field-by-field.

  ## Why this PRP exists separately

  - **Unblocks PRPs B–E in parallel.** PRP-B (queue impl + `createProfiler`),
    PRP-C (`runProfiler` loop), PRP-D (cost trip-wire + TTL + retry), PRP-E
    (integration + smoke) all type-check against this PRP.
  - **Unblocks Cluster C in parallel.** Verifier-prompt PRPs implement
    against `Verifier` / `Arbiter` pinned here.
  - **Precedent.** `PRPs/clusterB/harness-contracts.md` split this way;
    `features/clusterA/policy-match-evaluation.md:13-22` locks
    `PolicyMatchResult` as a discrete first step.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A. Compile-time-only; warm path.
  - **Pre-bid** — Honored by placement. Contracts in `@scout/shared`;
    profiler writes `ProfileStore`, gate reads it.
  - **Plug-and-play** — This PRP *is* the seam.
  - **Sponsor tech** — `Verifier` is the construction-time seam where
    every verifier→LLM call routes through Lobster Trap: real verifiers
    consume `LlmClient` from `@scout/llm-client` (the Lobster Trap proxy,
    `PRPs/foundation-ad-verification.md:115-203`); profiler never
    instantiates an LLM SDK. `AgentVerdict.lobstertrapTraceId` makes the
    audit-chain claim (`profiler-real-loop.md:109`) executable. Not
    implemented (no LLM call originates here).

  ## CLAUDE.md rules that bite

  § Stack: zod at every cross-package contract. § Working agreements:
  files ≤ ~300 lines (targets <100 each); no new runtime deps.

  ## Decisions (locked here)

  | # | Question | Locked answer |
  |---|---|---|
  | D1 | `ProfileJob` URL field name | `pageUrl` (feature open question 232–236, option A). Matches `bid.ts:6`. Gate's informal `url` (`features/clusterA/gate-verdict-logic.md:24-26`) aligns on gate's next pass. |
  | D2 | `attempt` lower bound | `int().min(1)`. 1 on first dispatch, `++` on nack-retry. |
  | D3 | `degradationHint` enum | `"none" \| "drop_video" \| "collapse_text_image"` (feature line 41). |
  | D4 | `geo` regex | Reuse `/^[A-Z]{2}$/` from `bid.ts:8`. Forwarded to `Harness.capturePage` opts. |
  | D5 | `ProfileJob.id` shape | `z.string().min(1)`. Full ULID regex pinned in PRP-B's generator test. |
  | D6–D9 | Schema reuse | `decision` → `DecisionSchema` (`primitives.ts:3`); `categories`/`consensusCategories` → `CategorySchema` (`profile.ts:3`); `detectedEntities`/`consensusEntities` → `DetectedEntitySchema` (`profile.ts:9`); `evidenceRefs` → `EvidenceRefSchema` (`profile.ts:16`). URI tenant-namespace rewrite is PRP-C. |
  | D10 | `lobstertrapTraceId` | `z.string().min(1).nullable()`. `null` ONLY on no-LLM degraded path. Empty-string is NOT the null sentinel. |
  | D11 | `ArbiterDecision.confidence` | `z.number().min(0).max(1)`. Same scale as `PolicyMatchResult.confidence`. |
  | D12 | `disagreements` element | `{ kind: "category" \| "entity", label, perVerifier: Record<"text"\|"image"\|"video", number> }` — all three perVerifier keys required. |
  | D13 | `ProfileQueue.consume` | `AsyncIterableIterator<{ job; ack(); nack(reason) }>`. `for await ... of` consumer. |
  | D14 | `NackReason` | `{ kind: "transient" \| "poison"; detail; retryAt? }`. PRP-D consumes for DLQ + backoff. |
  | D15 | Agent stub factory shape | `createXVerifier(deps?: { llm?: unknown }): Verifier`. `llm` is `unknown` to avoid pulling `@scout/llm-client` into `packages/agents/*`; Cluster C swaps to `LlmClient`. |
  | D16 | Interfaces directory | Already exists (harness PRP created it). Second occupant; appends only. |
  | D17 | `ProfileStore` / `AuditStore` | NOT redefined here. Foundation-owned. |

  ## All Needed Context

  ```yaml
  - file: features/clusterB/profiler-real-loop.md
    section: "schemas (30-66); interfaces (67-72); tests (113-116); EXAMPLES (142-155)"
    why: Source spec.
  - file: PRPs/clusterB/harness-contracts.md
    why: Structural precedent — same TDD/decisions/contracts/tasks shape.
  - file: packages/shared/src/schemas/primitives.ts
    why: DecisionSchema (3) — reused per D6.
  - file: packages/shared/src/schemas/profile.ts
    why: CategorySchema (3), DetectedEntitySchema (9), EvidenceRefSchema (16), PageProfileSchema (22) — reused per D7-D9.
  - file: packages/shared/src/schemas/bid.ts
    why: pageUrl (6) lineage for D1; geo regex (8) reused for D4.
  - file: packages/shared/src/schemas/capture.ts
    why: Style template (Alpha2 re-decl + `.strict()`); PageCapture is every Verifier's input.
  - file: packages/shared/src/schemas/verdict.ts
    why: lobstertrapTraceId (17) — `string | null` precedent for D10.
  - file: packages/shared/src/interfaces/harness.ts
    why: Style template for the three interface files.
  - file: packages/shared/src/index.ts
    why: Current barrel; append 5 `export *` lines.
  - file: packages/agents/text-verifier/src/index.ts
    why: Target stub upgrade. Mirror for image / video / arbiter.
  - file: PRPs/foundation-ad-verification.md
    section: "Contracts (132-145); LlmClient (115-203); ESLint (147-159)"
    why: Foundation names schemas/job.ts (135) but never lands it; this PRP does. ESLint already blocks LLM SDK imports in agents/profiler.
  ```

  ## Files to create / modify

  **Create** (each `.ts` + colocated `.test.ts`):
  `packages/shared/src/schemas/{job,agentVerdict}.ts`;
  `packages/shared/src/interfaces/{verifier,arbiter,profileQueue}.ts`.

  **Modify**: append 5 `export *` lines to `packages/shared/src/index.ts`;
  replace `export {};` in `packages/agents/{text,image,video}-verifier/src/index.ts`
  with `createXVerifier()`; ditto `arbiter` with `createArbiter()`.

  ## Target contracts — schemas

  ```ts
  // packages/shared/src/schemas/job.ts
  import { z } from "zod";
  const Alpha2 = z.string().regex(/^[A-Z]{2}$/); // reused from bid.ts:8 (D4)

  export const DegradationHintSchema = z.enum(["none", "drop_video", "collapse_text_image"]);
  export type DegradationHint = z.infer<typeof DegradationHintSchema>;

  /** Warm-path job. Gate enqueues, profiler consumes. `id` = idempotency key.
   * `degradationHint` is the FLOOR (PRP-D may upgrade, never downgrade). */
  export const ProfileJobSchema = z.object({
    id: z.string().min(1),                  // D5
    pageUrl: z.string().url(),              // D1
    advertiserId: z.string().min(1),
    policyId: z.string().min(1),
    geo: Alpha2,                            // D4
    enqueuedAt: z.string().datetime(),
    attempt: z.number().int().min(1),       // D2
    degradationHint: DegradationHintSchema, // D3
  });
  export type ProfileJob = z.infer<typeof ProfileJobSchema>;
  ```

  ```ts
  // packages/shared/src/schemas/agentVerdict.ts
  import { z } from "zod";
  import { DecisionSchema } from "./primitives.js";
  import { CategorySchema, DetectedEntitySchema, EvidenceRefSchema } from "./profile.js";

  export const VerifierKindSchema = z.enum(["text", "image", "video"]);
  export type VerifierKind = z.infer<typeof VerifierKindSchema>;

  /** `lobstertrapTraceId: null` ONLY on no-LLM degraded path (D10). */
  export const AgentVerdictSchema = z.object({
    verifier: VerifierKindSchema,
    decision: DecisionSchema,                          // D6
    categories: z.array(CategorySchema),               // D7
    detectedEntities: z.array(DetectedEntitySchema),   // D8
    evidenceRefs: z.array(EvidenceRefSchema),          // D9
    modelLatencyMs: z.number().int().nonnegative(),
    lobstertrapTraceId: z.string().min(1).nullable(),  // D10
  });
  export type AgentVerdict = z.infer<typeof AgentVerdictSchema>;

  export const DisagreementSchema = z.object({
    kind: z.enum(["category", "entity"]),
    label: z.string().min(1),
    perVerifier: z.object({ text: z.number(), image: z.number(), video: z.number() }),
  });
  export type Disagreement = z.infer<typeof DisagreementSchema>;

  export const ArbiterDecisionSchema = z.object({
    decision: DecisionSchema,
    confidence: z.number().min(0).max(1),                     // D11
    consensusCategories: z.array(CategorySchema),
    consensusEntities: z.array(DetectedEntitySchema),
    disagreements: z.array(DisagreementSchema),               // D12
    humanReviewRecommended: z.boolean(),
    lobstertrapTraceId: z.string().min(1).nullable(),
  });
  export type ArbiterDecision = z.infer<typeof ArbiterDecisionSchema>;
  ```

  ## Target contracts — interfaces

  All three files use `import type` only (no runtime). Imports omitted in
  the snippet below — each file pulls its types from `../schemas/*.js`.
  Style template: `packages/shared/src/interfaces/harness.ts`.

  ```ts
  // verifier.ts
  export interface VerifierContext {
    advertiserId: string; policyId: string;
    taxonomyHint?: string[]; degradationHint: DegradationHint;
    abortSignal: AbortSignal;
  }
  export interface Verifier {
    readonly kind: VerifierKind;
    verify(capture: PageCapture, ctx: VerifierContext): Promise<AgentVerdict>;
  }

  // arbiter.ts
  export interface ArbiterContext {
    advertiserId: string; policyId: string;
    humanReviewThreshold: number; abortSignal: AbortSignal;
  }
  export interface Arbiter {
    combine(verdicts: AgentVerdict[], capture: PageCapture, ctx: ArbiterContext): Promise<ArbiterDecision>;
  }

  // profileQueue.ts
  export interface NackReason {
    kind: "transient" | "poison";
    detail: string;
    retryAt?: string; // ISO8601; absent on poison (D14)
  }
  export interface QueueDelivery {
    job: ProfileJob;
    ack(): Promise<void>;
    nack(reason: NackReason): Promise<void>;
  }
  export interface ConsumeOptions { signal: AbortSignal; visibilityTimeoutMs: number }
  /** Gate enqueues; profiler consumes. Impls land in PRP-B. */
  export interface ProfileQueue {
    enqueue(job: ProfileJob): Promise<void>;
    consume(opts: ConsumeOptions): AsyncIterableIterator<QueueDelivery>;
  }
  ```

  ## Agent stub target shape

  STUB returns a fixed shape that `satisfies` the interface. Cluster C
  swaps the body for the real prompt + `LlmClient` call. `deps.llm: unknown`
  ON THE STUB (D15) so these packages do NOT pull `@scout/llm-client`
  prematurely; real verifiers will type it as `LlmClient`.

  ```ts
  // packages/agents/text-verifier/src/index.ts
  import type { AgentVerdict, PageCapture, Verifier, VerifierContext } from "@scout/shared";

  export function createTextVerifier(_deps?: { llm?: unknown }): Verifier {
    return {
      kind: "text",
      async verify(_c: PageCapture, _ctx: VerifierContext): Promise<AgentVerdict> {
        return { verifier: "text", decision: "ALLOW", categories: [],
          detectedEntities: [], evidenceRefs: [], modelLatencyMs: 0,
          lobstertrapTraceId: null };
      },
    };
  }
  ```

  Mechanical mirrors: `image-verifier` / `video-verifier` (replace
  `"text"` with `"image"` / `"video"` in both `kind` and `verifier`).

  ```ts
  // packages/agents/arbiter/src/index.ts
  import type { AgentVerdict, Arbiter, ArbiterContext, ArbiterDecision, PageCapture } from "@scout/shared";

  export function createArbiter(_deps?: { llm?: unknown }): Arbiter {
    return {
      async combine(_v: AgentVerdict[], _c: PageCapture, _ctx: ArbiterContext): Promise<ArbiterDecision> {
        return { decision: "ALLOW", confidence: 1.0,
          consensusCategories: [], consensusEntities: [], disagreements: [],
          humanReviewRecommended: false, lobstertrapTraceId: null };
      },
    };
  }
  ```

  ## Task order (TDD; commit-sized)

  ### Task 1 — Red→Green: `ProfileJobSchema` happy-path + barrel

  Red: `schemas/job.test.ts` happy-path only. Expected red:
  `'ProfileJobSchema' not exported`. Green: create `schemas/job.ts`; append
  barrel.

  ### Task 2 — Red→Green: `ProfileJobSchema` edge matrix

  Extend `job.test.ts`. Each subtest red-first:

  - `geo`: `"US"` accepted; `"us"`, `"USA"` rejected.
  - `attempt`: `1` accepted; `0`, `-1`, `1.5` rejected.
  - `degradationHint`: all 3 values accepted; `"NONE"`, `"other"` rejected.
  - `id: ""` rejected; ULID-shape accepted (`min(1)` only).
  - `pageUrl: "not-a-url"` rejected; `"https://x.test/"` accepted.
  - `enqueuedAt: "2026-05-16T00:00:00Z"` accepted; `"2026-05-16"` rejected.
  - `parse(null)` and `parse({})` both throw.

  ### Task 3 — Red→Green: `AgentVerdictSchema` + `ArbiterDecisionSchema`

  Write `schemas/agentVerdict.test.ts`. Cases:

  - **Happy** — `AgentVerdictSchema.parse(valid)` with `verifier: "text"`,
    `decision: "ALLOW"`, empty arrays, `modelLatencyMs: 0`,
    `lobstertrapTraceId: "lt_abc123"`; also a `null` traceId case (D10).
  - **Edges (reject)** — `verifier: "audio"` / `decision: "MAYBE"` /
    `modelLatencyMs: -1` / `categories[0].confidence: 1.1` /
    `lobstertrapTraceId: ""` (empty ≠ null sentinel, D10).
  - **Happy** — `ArbiterDecisionSchema.parse(valid)` with `confidence: 0.5`.
  - **Edges (reject)** — `confidence: 1.5` / `-0.1`;
    `disagreements[0].kind: "score"`; `perVerifier` missing `video` (D12).

  Create `schemas/agentVerdict.ts`. Append barrel.

  ### Task 4 — Red→Green: interface compile-tests

  For each of `verifier`, `arbiter`, `profileQueue`, write
  `interfaces/<name>.test.ts` that constructs a minimal literal and
  asserts `satisfies <Interface>`. Pattern (Verifier):

  ```ts
  import { describe, it, expect } from "vitest";
  import type { Verifier, AgentVerdict, PageCapture, VerifierContext } from "@scout/shared";

  describe("Verifier", () => {
    it("satisfies a minimal literal impl", () => {
      const impl = {
        kind: "text" as const,
        async verify(_c: PageCapture, _ctx: VerifierContext): Promise<AgentVerdict> {
          return { verifier: "text", decision: "ALLOW", categories: [],
            detectedEntities: [], evidenceRefs: [], modelLatencyMs: 0,
            lobstertrapTraceId: null };
        },
      } satisfies Verifier;
      expect(impl.kind).toBe("text");
    });
  });
  ```

  Interface drift → `tsc --noEmit` fails (red). Create the interface;
  append barrel; re-run → green. `profileQueue.test.ts` uses an
  `async *consume` generator on the literal.

  ### Task 5 — Red→Green: upgrade four agent stubs

  For each `packages/agents/{text,image,video}-verifier/src/index.ts`,
  write a colocated `index.test.ts` asserting (a) `createXVerifier()`
  returns a `Verifier` with the expected `kind`, and (b) `verify(...)`
  returns an `AgentVerdict` with `decision ∈ {ALLOW, DENY, HUMAN_REVIEW}`.
  Expected red: factory not exported. Green: replace body per § Agent stub
  shape. For `packages/agents/arbiter/src/index.ts`, test
  `createArbiter().combine([], ..., ...)` returns a valid `ArbiterDecision`.

  If an agent package has no `test` script, add `"test": "vitest run"` +
  minimal `vitest.config.ts` mirroring `packages/shared/vitest.config.ts`.

  **Stub contract** (feature line 264): tests assert *interface shape and
  call pattern*, not verdict content. Cluster C replaces the body.

  ### Task 6 — Validation gates (all must pass)

  ```bash
  pnpm -r exec tsc --noEmit               # 0 errors
  pnpm -r exec eslint . --fix             # clean
  pnpm -r exec prettier --write .         # clean
  pnpm --filter @scout/shared test        # green
  pnpm --filter "@scout/agent-*" test     # all 4 green
  pnpm -r build                           # clean
  grep -R "openai\|@google/genai" packages/agents packages/shared  # 0 hits
  ```

  No `pnpm audit` regression — no new runtime deps.

  ## Security guardrails

  Minimal — no runtime, no I/O, no env access.

  - **`lobstertrapTraceId: string | null` only-null-on-degraded-path**
    (D10) documented in JSDoc. PRP-C's loop asserts non-null on every
    non-degraded job; this makes the Veea-Award audit-chain claim executable.
  - **No `process.env.*`** — no runtime in this PRP.
  - **No `openai` / `@google/genai` import in `packages/agents/**` or
    `packages/shared/**`** — foundation ESLint rule (`PRPs/foundation-ad-verification.md:151-159`).
    `deps.llm?: unknown` lets Cluster C swap to `LlmClient` without re-locking.
  - **No raw `PageCapture.domText` in test fixtures** — literal short strings only.

  ## Out of scope — file as follow-ups

  - **PRP-B** — `InMemoryProfileQueue` impl (enqueue + consume + LRU
    dedupe + visibility-timeout) + `createProfiler` skeleton; ULID regex
    on `ProfileJob.id` (D5); `processedJobIds` LRU.
  - **PRP-C** — `runProfiler` loop: `Promise.allSettled` fanout + arbiter +
    commit (`PageCapture + ArbiterDecision → PageProfile` incl. tenant
    URI rewrite) + audit row; file sentinel `verifier_blackout` baseline rule.
  - **PRP-D** — `costTripwire.ts`, `ttlPolicy.ts`, `retry.ts`.
  - **PRP-E** — integration test (in-memory rig) + smoke script.
  - **Cluster C** — real verifier prompts + arbiter scoring (replace stub bodies).
  - **Gate-side `pageUrl` rename** (D1).

  ## Anti-Patterns

  - Don't skip the red step. Don't commit at red unless `WIP — red`.
  - Don't widen `Decision` to `string`. Reuse `DecisionSchema` (D6).
  - Don't add fields the tests don't pin.
  - Don't add `process.env.*` — no runtime.
  - Don't import `@scout/llm-client` into `packages/agents/*` — the
    `deps?: { llm?: unknown }` placeholder is the point of D15.
  - Don't redefine `ProfileStore` / `AuditStore` (D17).
  - Don't factor `Alpha2` into `primitives.ts` here — defer (mirrors
    harness-contracts.md Task 6's same call).

  ## Confidence: 9 / 10

  Pure-contract PRP in a package that already follows the same shape for
  six other schemas + one interface. One risk: D1 (`pageUrl` vs. gate's
  informal `url`) needs a one-line gate-side follow-up — surfaced in
  § Decisions + § Out of scope so it can't slip.
