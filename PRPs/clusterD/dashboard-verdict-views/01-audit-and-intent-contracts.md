name: "Dashboard — PRP 01: audit + intent contracts in `@scout/shared` (TDD)"
description: |

  First of seven PRPs implementing `features/clusterD/dashboard-verdict-views.md`.
  This PRP lands ONLY two new schema files in `@scout/shared`:
  `schemas/intent.ts` (`LobstertrapDeclaredIntentSchema`,
  `LobstertrapDetectedIntentSchema`) and `schemas/audit.ts`
  (`AuditRowSchema` as a discriminated union plus its variant exports).
  No store changes, no backend, no views — those land in PRPs 02–07.

  ## TDD discipline (applies to every task below)

  Mirrors `PRPs/clusterB/harness-contracts.md:10-34` verbatim. Every task
  is **red → green → refactor**:

  1. **Red.** Write the test first. Run
     `pnpm --filter @scout/shared test -- <file>`. Confirm it fails for
     the *expected reason* — usually `ERR_MODULE_NOT_FOUND` or `TS2307`
     on the import line. A test that fails for the wrong reason (typo,
     syntax error) is not a real red — fix the test first.
  2. **Green.** Minimum impl to flip green. Resist adding fields the
     test doesn't exercise.
  3. **Refactor.** Only after green: tidy, run `tsc --noEmit` +
     `eslint --fix`. Tests stay green; no behavior change.

  Commit at green (one commit per red→green pair is fine; never commit
  at red unless the message says `WIP — red`).

  ## Why this PRP exists separately

  - **Unblocks PRPs 02, 03, and 07 in parallel.** PRP 02 refactors
    `@scout/store` to consume `AuditRowSchema`; PRP 03 stands up
    `@scout/dashboard-backend`; PRP 07 (intent-diff view) renders
    `LobstertrapDeclaredIntent` / `LobstertrapDetectedIntent`. All three
    need these types before they can start.
  - **Cluster A precedent.** `features/clusterA/policy-match-evaluation.md:13-22`
    locks `PolicyMatchResult` in `@scout/shared` as its own discrete
    step; cluster B mirrors the same pattern for `PageCapture`.
  - **Foundation named these files but never landed them.**
    `PRPs/foundation-ad-verification.md:135` names `intent.ts`;
    `packages/shared/src/index.ts:1-8` shows no `intent` export.
    Merge-order notes: `features/clusterD/dashboard-verdict-views.md:154-161`.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A; contracts have no runtime.
  - **Pre-bid** — Honored by placement in `@scout/shared`, the only
    package the hot-path `@scout/gate` consumes for typed audit writes.
  - **Plug-and-play** — This PRP *is* the seam. Both write-side
    (`@scout/store`, PRP 02) and read-side (`@scout/dashboard-backend`,
    PRP 03) consume the same `AuditRowSchema`.
  - **Sponsor tech** — Neither. No LLM call originates here; Lobster
    Trap seam preserved. The intent schemas are the typed surface the
    Lobster Trap audit-log linkage (`PRPs/foundation-ad-verification.md:142-143`)
    lands into.

  ## CLAUDE.md rules that bite

  - § Stack — zod at every cross-package contract; no bare TS interfaces.
  - § Working agreements — files ≤ ~300 lines (both target files come
    well under); 1 happy / 1 edge / 1 failure per new file (≥3 tests
    per schema across two test files).

  ## Decisions (locked here)

  | # | Question | Locked answer | Why |
  |---|---|---|---|
  | D1 | Schema location | `@scout/shared` (`schemas/intent.ts` + `schemas/audit.ts`). | Foundation names `intent.ts` at `foundation-ad-verification.md:135`; matches cluster A/B precedent. |
  | D2 | Discriminator key | `kind`. | Feature spec lines 27, 34. |
  | D3 | Union encoding | `z.discriminatedUnion("kind", [...])`. | Linear parse, exhaustive narrowing, error names offending variant. |
  | D4 | DLQ `pageUrl` validation | `z.string().url()`. | Consistency with `bid.ts:6`. |
  | D5 | DLQ `attempts` range | `z.number().int().positive()` — no upper bound. | Retry caps belong to the profiler PRP. |
  | D6 | `declaredIntent` / `detectedIntent` nullability | `.nullable()`, NOT `.optional()`. | LLM-bypass verdicts (`verdict.ts:17` `lobstertrapTraceId: null`) carry `null` explicitly; wire shape always has the key. |
  | D7 | `declared_paths` | `z.array(z.string()).optional()`. | Veea README flags as optional; `foundation-ad-verification.md:142-143`. |
  | D8 | `divergence` / `evidence` | both `z.string().nullable()`. | Null when declared == detected; wire keys always present. |
  | D9 | `ts` shape | `z.string().datetime()`. | Matches `profile.ts:29` + `bid.ts:9`. |
  | D10 | Variant re-exports | `AuditRowVerdictSchema` + `AuditRowProfileJobDlqSchema` named. | Downstream view PRPs narrow without re-deriving from the union. |

  ## All Needed Context

  ```yaml
  - file: features/clusterD/dashboard-verdict-views.md
    section: "FEATURE — AuditStore read interface (lines 26-40);
      Coordination with foundation (lines 73-74, 154-161)"
    why: Source spec for AuditRowSchema variants and the foundation
      merge-order story this PRP implements (case B).

  - file: PRPs/clusterB/harness-contracts.md
    section: "Entire file"
    why: Style template. TDD discipline, decision-table format, task-order
      pattern, section order all mirror this PRP.

  - file: PRPs/foundation-ad-verification.md
    section: "lines 135, 142-143"
    why: Foundation names intent.ts but doesn't land it; this PRP is the
      first occupant. Declared-intent field names sourced here.

  - file: packages/shared/src/schemas/primitives.ts
    why: DecisionSchema source for re-exports in the verdict variant
      (transitively via VerificationVerdictSchema).

  - file: packages/shared/src/schemas/bid.ts
    why: BidVerificationRequestSchema is embedded in the verdict variant
      (per feature spec line 39). pageUrl shape (z.string().url()) is the
      precedent for D4.

  - file: packages/shared/src/schemas/profile.ts
    why: PageProfileSchema is embedded (nullable) in the verdict variant.
      capturedAt: z.string().datetime() is the precedent for D9.

  - file: packages/shared/src/schemas/policy.ts
    why: Policy is NOT embedded in AuditRow — see feature spec line 132,
      "No raw policy payload reaches the client." Only policyVersion (a
      string on VerificationVerdict) crosses the boundary.

  - file: packages/shared/src/schemas/verdict.ts
    why: VerificationVerdictSchema is embedded in the verdict variant.
      lobstertrapTraceId being nullable is the why for D6.

  - file: packages/shared/src/index.ts
    why: Current barrel (8 exports); this PRP appends two `export *` lines.

  - file: packages/store/src/index.ts
    section: "lines 18-24"
    why: Existing write-side AuditRow interface that PRP 02 will refactor
      to consume AuditRowSchema. This PRP does NOT touch it (see § Out
      of scope).
  ```

  ## Files to create

  - `packages/shared/src/schemas/intent.ts`
  - `packages/shared/src/schemas/audit.ts`
  - `packages/shared/src/schemas/intent.test.ts`
  - `packages/shared/src/schemas/audit.test.ts`

  ## Files to modify

  - `packages/shared/src/index.ts` — append:
    ```ts
    export * from "./schemas/intent.js";
    export * from "./schemas/audit.js";
    ```

  ## Target contract — `packages/shared/src/schemas/intent.ts`

  ```ts
  import { z } from "zod";

  // Per PRPs/foundation-ad-verification.md:142-143 + Veea README §
  // Bidirectional metadata headers. Sent by every LLM-calling agent on
  // the outbound request body under `_lobstertrap.declared_intent`.
  export const LobstertrapDeclaredIntentSchema = z.object({
    declared_intent: z.string().min(1),
    agent_id: z.string().min(1),
    declared_paths: z.array(z.string()).optional(),
  });
  export type LobstertrapDeclaredIntent = z.infer<
    typeof LobstertrapDeclaredIntentSchema
  >;

  // Surfaced by Lobster Trap's DPI proxy. `divergence` and `evidence`
  // are null when declared == detected; non-null carries a one-line
  // human-readable explanation the dashboard IntentDiff view renders.
  // Both are treated as untrusted strings (see § Security guardrails).
  export const LobstertrapDetectedIntentSchema = z.object({
    detected_intent: z.string().min(1),
    divergence: z.string().nullable(),
    evidence: z.string().nullable(),
  });
  export type LobstertrapDetectedIntent = z.infer<
    typeof LobstertrapDetectedIntentSchema
  >;
  ```

  ## Target contract — `packages/shared/src/schemas/audit.ts`

  ```ts
  import { z } from "zod";
  import { BidVerificationRequestSchema } from "./bid.js";
  import { PageProfileSchema } from "./profile.js";
  import { VerificationVerdictSchema } from "./verdict.js";
  import {
    LobstertrapDeclaredIntentSchema,
    LobstertrapDetectedIntentSchema,
  } from "./intent.js";

  const AuditRowBase = {
    id: z.string().min(1),
    advertiserId: z.string().min(1),
    ts: z.string().datetime(),
  };

  export const AuditRowVerdictSchema = z.object({
    kind: z.literal("verdict"),
    ...AuditRowBase,
    request: BidVerificationRequestSchema,
    verdict: VerificationVerdictSchema,
    profile: PageProfileSchema.nullable(),
    declaredIntent: LobstertrapDeclaredIntentSchema.nullable(),
    detectedIntent: LobstertrapDetectedIntentSchema.nullable(),
  });
  export type AuditRowVerdict = z.infer<typeof AuditRowVerdictSchema>;

  export const AuditRowProfileJobDlqSchema = z.object({
    kind: z.literal("profile_job_dlq"),
    ...AuditRowBase,
    jobId: z.string().min(1),
    pageUrl: z.string().url(),
    attempts: z.number().int().positive(),
    nackReason: z.string().min(1),
  });
  export type AuditRowProfileJobDlq = z.infer<
    typeof AuditRowProfileJobDlqSchema
  >;

  export const AuditRowSchema = z.discriminatedUnion("kind", [
    AuditRowVerdictSchema,
    AuditRowProfileJobDlqSchema,
  ]);
  export type AuditRow = z.infer<typeof AuditRowSchema>;
  ```

  ## Task order (TDD; commit-sized; use TaskCreate / TaskUpdate)

  ### Task 1 — Red: happy path for `LobstertrapDeclaredIntentSchema`

  Write `packages/shared/src/schemas/intent.test.ts` with ONE test that
  imports `LobstertrapDeclaredIntentSchema` from `@scout/shared` and
  parses a hand-built valid literal `{ declared_intent: "classify page
  against policy", agent_id: "gate-flash" }`. Run:

  ```bash
  pnpm --filter @scout/shared test -- intent.test.ts
  ```

  **Expected red**: `Cannot find module './schemas/intent.js'` or
  `'LobstertrapDeclaredIntentSchema' is not exported`. Any other failure
  = fix the test first.

  ### Task 2 — Green: minimal `intent.ts`

  Create `packages/shared/src/schemas/intent.ts` with BOTH schemas per §
  Target contract (the test in Task 1 only exercises the declared
  schema, but the detected schema is one cycle away and the alternative
  is two index.ts edits — accept the slight overshoot). Append
  `export * from "./schemas/intent.js"` to `packages/shared/src/index.ts`.
  Re-run Task 1 → green. Commit.

  ### Task 3 — Red→Green: edge + failure for `LobstertrapDeclaredIntentSchema`

  Extend `intent.test.ts`:

  - **Edge** — `declared_paths: []` accepted; `declared_paths: ["/foo",
    "/bar"]` accepted; key omitted entirely accepted (optional).
  - **Failure** — `declared_intent: ""` rejected (`.min(1)`).
  - **Failure** — `agent_id` missing rejected.
  - **Failure** — `parse(null)` throws.

  Each subtest added red-first against the current schema. Most pass
  already from Task 2's overshoot; write them anyway to lock behavior.

  ### Task 4 — Red→Green: happy/edge/failure for `LobstertrapDetectedIntentSchema`

  Extend `intent.test.ts`:

  - **Happy** — `{ detected_intent: "classification", divergence: null,
    evidence: null }` parses.
  - **Edge** — both `divergence` and `evidence` carry non-null strings
    (the "Lobster Trap caught a divergence" case); parses.
  - **Failure** — `divergence: undefined` rejected (must be `string |
    null`, not missing).

  Confirm ≥3 tests on the detected schema, ≥3 on the declared schema.
  Commit.

  ### Task 5 — Red: happy path for `AuditRowSchema` (verdict variant)

  Write `packages/shared/src/schemas/audit.test.ts` importing
  `AuditRowSchema` from `@scout/shared` and parsing a hand-built verdict
  variant: a full `AuditRow` with `kind: "verdict"`, a valid embedded
  `BidVerificationRequest`, `VerificationVerdict`, `null` profile, and
  `null` for both intent fields (the cached-clean-path case from D6).
  Run → red (`schemas/audit.js` doesn't exist).

  ### Task 6 — Green: minimal `audit.ts`

  Create `packages/shared/src/schemas/audit.ts` per § Target contract.
  Append `export * from "./schemas/audit.js"` to
  `packages/shared/src/index.ts`. Re-run Task 5 → green. Commit.

  ### Task 7 — Red→Green: edge + failure matrix for `AuditRowSchema`

  Extend `audit.test.ts`:

  - **Happy (DLQ variant)** — `{ kind: "profile_job_dlq", id, advertiserId,
    ts, jobId, pageUrl: "https://example.com/x", attempts: 3, nackReason:
    "timeout" }` parses; narrows via `if (row.kind === "profile_job_dlq")`
    to `AuditRowProfileJobDlq` (compile-time check).
  - **Edge** — verdict variant with non-null profile + non-null
    declaredIntent + non-null detectedIntent (the showpiece divergence
    row) parses.
  - **Edge** — DLQ variant with `attempts: 1` parses; `attempts: 0`
    rejected (`.positive()`); `attempts: 1.5` rejected (`.int()`).
  - **Edge** — DLQ variant with `pageUrl: "not-a-url"` rejected
    (`.url()`).
  - **Failure** — `kind: "unknown"` rejected by `discriminatedUnion`
    (assert the zod error names "kind" as the discriminator).
  - **Failure** — verdict variant with `declaredIntent` *missing* (not
    null) rejected — the wire shape requires the key (D6).
  - **Failure** — `parse(null)` throws.
  - **Determinism** — `AuditRowSchema.parse(x)` twice yields deep-equal
    results.

  Confirm ≥3 tests on `AuditRowSchema` total across happy/edge/failure.
  Commit.

  ### Task 8 — Full validation sweep

  ```bash
  pnpm --filter @scout/shared test
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r exec prettier --write .
  pnpm -r build
  ```

  No `pnpm audit` regression expected — this PRP adds no runtime deps
  (zod is already in `@scout/shared`'s dependency tree).

  ## Security guardrails

  Minimal — no runtime, no I/O, no env access.

  - `LobstertrapDetectedIntent.evidence` and `.divergence` are
    **untrusted strings** sourced from Lobster Trap's DPI inspection of
    LLM prompt bodies. They can contain attacker-controlled content
    (e.g., a page that successfully prompt-injects a verifier will see
    its injection echoed in `evidence`). This PRP's contract treats
    them as opaque `z.string().nullable()` strings; the dashboard
    `IntentDiff` view (PRP 07) is the layer that MUST escape them
    before rendering. Document in JSDoc on `LobstertrapDetectedIntentSchema`.
  - No `process.env.*` access in this PRP. Schemas have no runtime.
  - `pageUrl: z.string().url()` on the DLQ variant rejects `javascript:`
    URIs at the seam (zod's URL parser rejects them) — a defense-in-depth
    measure given the dashboard renders this field as a link in
    `VerdictTimeline`.

  ## Out of scope

  - **`@scout/store` refactor.** `packages/store/src/index.ts:18-24`
    declares a write-side `AuditRow` interface that this PRP supersedes.
    **PRP 02** replaces it with `import type { AuditRow } from "@scout/shared"`,
    widens `AuditStore.put` to the discriminated union, and adds the
    `query` + `get` read methods (feature spec lines 27–39). This PRP
    does NOT touch `@scout/store`.
  - **Backend routes, tenant isolation** — `@scout/dashboard-backend`,
    three endpoints, session-derived `advertiserId` — **PRP 03**.
  - **View code** — `VerdictTimeline`, `ReasonsDrilldown`, `IntentDiff`,
    `App.tsx`, fixtures, `axe-core` audit — **PRPs 04–07**.
  - **Polling, `ETag`** — PRPs 03–04.
  - **Lobster Trap iframe** — PRP 04.
  - **`Policy.declaredIntent` extension** (feature spec lines 118–122)
    — separate follow-up to `policy-match-evaluation.md`; this PRP's
    intent schemas stand alone.

  ## Anti-Patterns

  - Don't skip the red step. "It will obviously fail" is not "I ran it
    and it failed for the right reason."
  - Don't add fields the tests don't exercise.
  - Don't widen the discriminator beyond `"verdict" | "profile_job_dlq"`
    "for forward compat" — a third variant lands as its own PRP (e.g.,
    `dashboard-human-review-queue.md` per feature spec line 145).
  - Don't make `declaredIntent` / `detectedIntent` non-nullable. Gate
    verdicts that bypass the LLM (cached profile + deterministic policy
    match) emit `lobstertrapTraceId: null` per `verdict.ts:17`; their
    audit row carries `null` for both intent fields. Non-nullable
    breaks the cached-clean-path write at runtime.
  - Don't use `z.union` instead of `z.discriminatedUnion` — the latter's
    error messages cite the discriminator by name.
  - Don't add `process.env.*` access. This PRP has no runtime.
  - Don't import `@scout/store` from `@scout/shared`. PRP 02 makes
    `@scout/store` consume `@scout/shared`, never the reverse.
  - Don't commit at red unless the message is explicitly `WIP — red`.
  - Don't relitigate D6 in the view PRPs — wire shape is fixed here.

  ## Confidence: 9 / 10

  Greenfield schemas in a package that already follows the same shape
  for six other schemas. The one risk: D6's nullable-not-optional
  decision interacts with the write-side `AuditRow` interface in
  `@scout/store` that PRP 02 will refactor — if PRP 02's reviewer pushes
  back on the nullability shape, the fix is a one-line schema change
  here, not a structural rewrite.
