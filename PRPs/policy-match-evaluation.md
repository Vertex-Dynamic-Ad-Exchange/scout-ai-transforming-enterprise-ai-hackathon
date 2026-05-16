name: "Policy Match Evaluation — Deterministic Rule Engine + Match Contract Lock"
description: |

  Replace the current heuristic `@scout/policy` matcher with a deterministic,
  fail-closed, pure-function rule evaluator and lock a shared cross-package
  `PolicyMatchResult` contract in `@scout/shared`.

  This feature is hot-path critical (called by `@scout/gate` on every cache hit),
  but does not call any LLM or network service directly. It must stay sub-millisecond
  p95 inside gate's SLA budget and preserve tenant isolation semantics through an
  executable store contract test.

---

## Goal

Ship a production-ready `match(profile, policy) => PolicyMatchResult` implementation for
`@scout/policy` that is deterministic, schema-validated, and plug-and-play across
packages. Replace the current permissive matcher behavior with strict semantics:

- Rule kind dispatch is exhaustive (`category`, `entity`, `creative_tag`).
- Matching is exact string equality (v1), not fuzzy includes.
- Decision precedence is fail-closed: `DENY > HUMAN_REVIEW > ALLOW`.
- No-fire path follows policy escalation (`policy.escalation.ambiguousAction`) with
  `confidence = 0`.
- `firedRules` only expose safe references (`ruleId`, `kind`, `signalConfidence`), never
  advertiser-private rule match strings.
- Output is validated with zod at the function boundary before return.

---

## Why

- The gate path now depends on real policy evaluation; current matcher behavior is too
  permissive and non-deterministic for brand-safety decisions.
- A wrong `ALLOW` is materially worse than a wrong `DENY`; this module must implement
  explicit fail-closed precedence and predictable ambiguity signaling.
- `PolicyMatchResult` is currently package-local shape drift risk; locking it in
  `@scout/shared` prevents integration breakages between `@scout/policy` and `@scout/gate`.
- Tenant isolation is a cross-package security invariant (`store` + `gate` + `policy`);
  this PRP adds executable contract coverage so future store implementations cannot regress.

---

## Assumptions (explicit, policy/security touching)

1. This feature runs on the **pre-bid hot path** via `@scout/gate`, so all behavior is
   fail-closed by default.
2. `PolicyMatchResult` belongs in `@scout/shared` as a cross-package contract because
   policy emits it and gate consumes it.
3. `creative_tag` remains no-fire in v1 because `PageProfile` currently has no
   `creativeTags` field.
4. `PolicyStore` is the tenant enforcement boundary; `match()` receives an already
   tenant-scoped `Policy` and should stay pure.

---

## Hackathon Constraint Check

| Constraint | Status | Evidence |
|---|---|---|
| Sub-second end-to-end verification | ✅ preserved | `policy.match` is pure, no I/O, target ≤1ms p95 contribution within gate budget |
| Pre-bid, not post-impression | ✅ preserved | Feature is synchronous rule evaluation inside `POST /verify` decision path |
| Plug-and-play modules | ✅ strengthened | Shared typed contract + pure function + no runtime coupling to stores/LLM |
| Sponsor tech load-bearing | ✅ compatible | Output directly drives Gemini Flash escalation path in gate and Lobster Trap-audited decisions; no bypass introduced |

---

## All Needed Context

### Required Project Docs (read in this order)

```yaml
- file: CLAUDE.md
  why: Hard constraints, security agreements, file-size and test requirements.

- file: HACKATHON-CONTEXT.md
  why: Track constraints and sponsor-tech positioning for demo narrative.

- file: PLANNING.md
  why: Confirms gate pipeline is implemented and policy matcher is now consumed on hot path.

- file: README.md
  why: Workspace package map and standard commands.
```

### Documentation & References (external, current)

```yaml
- url: https://ai.google.dev/gemini-api/docs/openai
  why: Confirms OpenAI compatibility endpoint format used by gate/llm-client integration.
  critical: baseURL is https://generativelanguage.googleapis.com/v1beta/openai/

- url: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash
  why: Confirms stable model code is gemini-2.5-flash for hot-path escalation.
  critical: pin stable model IDs, avoid -latest aliases.

- url: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro
  why: Confirms stable model code for off-path verifier/arbiter usage.
  critical: supports long-context reasoning for warm-path agents.

- url: https://raw.githubusercontent.com/veeainc/lobstertrap/main/README.md
  why: Authoritative Lobster Trap policy actions, bidirectional _lobstertrap metadata, and OpenAI-compatible proxy behavior.
  critical: actions include ALLOW/DENY/HUMAN_REVIEW/QUARANTINE/RATE_LIMIT; request/response _lobstertrap metadata carries verdict + request_id.

- url: https://vitest.dev/api/#test-each
  why: Table-driven tests for precedence and confidence matrix.

- url: https://fast-check.dev/docs/introduction/
  why: Optional determinism property testing.
```

### Current Codebase Tree (feature-relevant)

```bash
packages/
  policy/
    src/index.ts                   # existing heuristic matcher (to replace/refactor)
  shared/
    src/index.ts                   # barrel (add match exports)
    src/schemas/policy.ts          # Policy + PolicyRule + Escalation
    src/schemas/profile.ts         # PageProfile, Category, DetectedEntity
    src/schemas/primitives.ts      # Decision enum
    src/schemas/verdict.ts         # Reason semantics downstream
  gate/
    src/handler.ts                 # consumes policy match result for clear-cut vs escalation
    src/verdict.ts                 # currently expects matchedRules with matchedValue
    src/handler.test.ts
    src/handler.failure.test.ts
  store/
    src/index.ts                   # tenant-scoped PolicyStore.get(policyId, advertiserId)
```

### Desired Codebase Tree

```bash
packages/
  shared/
    src/schemas/match.ts           # NEW: FiredRuleSchema + PolicyMatchResultSchema
    src/index.ts                   # MODIFIED: export match schema/types
  policy/
    src/index.ts                   # MODIFIED: barrel + createPolicyMatcher
    src/match.ts                   # NEW: core deterministic match()
    src/evaluators.ts              # NEW: per-kind evaluator helpers
    src/aggregateConfidence.ts     # NEW: noisy-OR confidence aggregation
    src/match.test.ts              # NEW: exhaustive matrix tests
    src/tenant-isolation.contract.test.ts  # NEW: PolicyStore contract test
    fixtures/
      brand-safe-news.json         # NEW: valid Policy fixture
      gambling-strict.json         # NEW: valid Policy fixture
      permissive-baseline.json     # NEW: valid Policy fixture
  gate/
    src/verdict.ts                 # MODIFIED: consume firedRules shape (no matchedValue)
```

### Existing Patterns to Mirror

```yaml
- file: packages/shared/src/schemas/policy.ts
  why: zod-first schema + exported infer type pattern to follow.

- file: packages/shared/src/schemas/profile.ts
  why: profile signal shapes and confidence ranges.

- file: packages/gate/src/handler.ts
  why: gate uses matcher output for clear-cut/ambiguous branching; confidence semantics must remain compatible.

- file: packages/store/src/index.ts
  why: tenant-scoped policy lookup API contract that must be tested for isolation.
```

---

## Known Gotchas and Library Quirks

```text
# CRITICAL: This feature is hot-path; any I/O, env access, time/rng usage breaks determinism and latency.
# CRITICAL: Current policy matcher uses case-insensitive includes; v1 contract requires exact equality.
# CRITICAL: creative_tag exists in PolicyRule.kind, but PageProfile has no creativeTags field; evaluator must no-fire explicitly.
# CRITICAL: Policy version is opaque string; copy verbatim into output (no semver normalization).
# CRITICAL: firedRules order must be deterministic (sort lexicographically by ruleId).
# CRITICAL: Never expose PolicyRule.match in output; can leak advertiser-private strategy.
# CRITICAL: Gate currently builds reason detail from matchedValue; update gate to reconstruct details from policy/ruleId.
# CRITICAL: noUncheckedIndexedAccess + strict mode means guard all array indexing.
# CRITICAL: Decision precedence cannot be confidence-weighted; fail-closed precedence is required.
```

---

## Security Guardrails (non-negotiable)

1. No secrets in client/UI; no new public env vars.
2. No LLM keys/credentials in `@scout/policy` or fixtures.
3. `match()` must remain pure and side-effect free: no network, fs, env, clock, random.
4. All inbound/outbound contracts validated with zod (`PolicySchema`, `PageProfileSchema`,
   `PolicyMatchResultSchema`).
5. Inter-agent security seam remains in Lobster Trap; this feature must not introduce direct
   agent-to-agent bypass paths.
6. A Lobster Trap `DENY`/`QUARANTINE` still wins downstream in gate; this PRP must preserve
   compatibility with that decision precedence.
7. Tenant isolation contract test must prove cross-tenant policy lookups return null/undefined
   without distinguishable error details.

---

## Implementation Blueprint

### Public Contract First (before internals)

Define and export these schemas/types in `@scout/shared`:

```ts
export const FiredRuleSchema = z.object({
  ruleId: z.string().min(1),
  kind: z.enum(["category", "entity", "creative_tag"]),
  signalConfidence: z.number().min(0).max(1),
});

export const PolicyMatchResultSchema = z.object({
  decision: DecisionSchema,
  confidence: z.number().min(0).max(1),
  firedRules: z.array(FiredRuleSchema),
  policyVersion: z.string().min(1),
});
```

Then update `@scout/policy` and `@scout/gate` to consume this contract.

### Core Evaluation Semantics

1. Evaluate each policy rule against profile signals by `kind`.
2. Rule fires only when:
   - `category`: `category.label === rule.match` and `category.confidence >= CONFIDENCE_FLOOR`.
   - `entity`: `entity.name === rule.match` and `entity.confidence >= CONFIDENCE_FLOOR`.
   - `creative_tag`: always no-fire (documented v1 gap).
3. Build `firedRules` with `ruleId`, `kind`, `signalConfidence`.
4. Apply decision precedence:
   - any DENY rule fired -> `decision = DENY`
   - else any HUMAN_REVIEW fired -> `decision = HUMAN_REVIEW`
   - else any ALLOW fired -> `decision = ALLOW`
   - else no-fire -> `decision = policy.escalation.ambiguousAction`
5. Compute confidence:
   - no-fire: `0`
   - otherwise noisy-OR over winning-action confidences:
     `1 - product(1 - c_i)`
6. Sort `firedRules` by `ruleId` asc for deterministic output.
7. Return `PolicyMatchResultSchema.parse(result)` as final step.

### Error-Handling Strategy

- Reject invalid inbound profile/policy at boundary via zod parse.
- Never retry inside `match()` (pure deterministic function).
- If boundary validation fails in consumer code, fail closed at gate layer (`DENY`).
- Function-level failures should throw synchronously; consumer handles fail-closed semantics.

---

## Task List (ordered, commit-sized)

```yaml
Task 1: Add shared match contract
  MODIFY packages/shared/src/index.ts:
    - export new match schema/types
  CREATE packages/shared/src/schemas/match.ts:
    - FiredRuleSchema
    - PolicyMatchResultSchema
    - inferred types

Task 2: Refactor policy package to modular deterministic engine
  CREATE packages/policy/src/evaluators.ts:
    - evaluateCategoryRule()
    - evaluateEntityRule()
    - evaluateCreativeTagRule()
  CREATE packages/policy/src/aggregateConfidence.ts:
    - noisyOr(confidences: number[]): number
  CREATE packages/policy/src/match.ts:
    - pure match(profile, policy)
    - exhaustive switch on rule.kind
    - precedence + confidence + sort + parse
  MODIFY packages/policy/src/index.ts:
    - barrel exports + createPolicyMatcher wrapper

Task 3: Add policy fixtures
  CREATE packages/policy/fixtures/brand-safe-news.json
  CREATE packages/policy/fixtures/gambling-strict.json
  CREATE packages/policy/fixtures/permissive-baseline.json
    - all must pass PolicySchema.parse

Task 4: Add exhaustive unit tests for matcher
  CREATE packages/policy/src/match.test.ts:
    - output schema conformance
    - 6 single-rule cases (2 kinds x 3 actions)
    - precedence cases
    - no-fire + ambiguousAction matrix
    - confidence floor boundary tests
    - noisy-OR numeric test
    - determinism + ordering tests
    - creative_tag no-fire test

Task 5: Add tenant isolation contract test
  CREATE packages/policy/src/tenant-isolation.contract.test.ts:
    - use createStores() in-memory policyStore
    - assert get(policyId, wrongAdvertiser) returns null/undefined
    - no distinguishable tenant existence leakage

Task 6: Update gate integration for new result shape
  MODIFY packages/gate/src/verdict.ts:
    - adapt buildReasonsFromMatch() to firedRules (no matchedValue)
    - reconstruct detail safely from ruleId/kind
  MODIFY tests if needed:
    - keep behavior expectations stable

Task 7: Run validation gates + latency sanity
  - typecheck, lint, tests, build, audit
  - ensure gate benchmark still passes p95/p99 targets
```

### Per-Task Pseudocode

```ts
// Task 2 core
function match(profile: PageProfile, policy: Policy): PolicyMatchResult {
  const fired = [];
  for (const rule of policy.rules) {
    switch (rule.kind) {
      case "category": /* exact match on label + confidence floor */ break;
      case "entity": /* exact match on entity.name + confidence floor */ break;
      case "creative_tag": /* v1 no-fire */ break;
      default: assertNever(rule.kind);
    }
  }

  const decision = resolveDecisionByPrecedence(fired, policy.escalation.ambiguousAction);
  const confidence = fired.length === 0 ? 0 : noisyOr(firedForWinningDecision.map(r => r.signalConfidence));
  const out = { decision, confidence, firedRules: sortByRuleId(fired), policyVersion: policy.version };
  return PolicyMatchResultSchema.parse(out);
}
```

### Integration Points

```yaml
@scout/shared:
  - add schemas/match.ts + barrel export
@scout/policy:
  - implement modular matcher
@scout/gate:
  - adapt reason building to new firedRules payload
@scout/store:
  - consumed only in contract test for tenant isolation
```

---

## Validation Loop

### Level 1: Type + lint + format

```bash
pnpm -r exec tsc --noEmit
pnpm -r exec eslint . --fix
pnpm -r exec prettier --write .
```

### Level 2: Unit tests

```bash
pnpm --filter @scout/policy test
pnpm --filter @scout/gate test
```

Required coverage for this feature:
- Happy path: clear allow/deny with valid signals
- Edge path: no-fire + ambiguousAction, creative_tag no-fire
- Failure path: invalid boundaries rejected; tenant isolation mismatch

### Level 3: Build + security + latency gate

```bash
pnpm -r build
pnpm audit
pnpm --filter @scout/gate bench
```

Latency gate: `policy.match` should remain ≤1ms p95 contribution in gate benchmark; any regression requires rollback or optimization before merge.

---

## Final Validation Checklist

- [ ] `PolicyMatchResult` contract exists in `@scout/shared` and is exported from barrel
- [ ] `@scout/policy` matcher is pure/deterministic (no I/O, env, clock, random)
- [ ] Exhaustive switch over `PolicyRule.kind` with explicit `creative_tag` no-fire
- [ ] Exact matching semantics implemented (no fuzzy includes)
- [ ] Decision precedence is `DENY > HUMAN_REVIEW > ALLOW`
- [ ] No-fire path respects `policy.escalation.ambiguousAction`
- [ ] Confidence is in `[0,1]` and uses noisy-OR on winning action only
- [ ] `firedRules` sorted lexicographically by `ruleId`
- [ ] Output parsed with `PolicyMatchResultSchema.parse` before return
- [ ] Tenant isolation contract test exists and passes for in-memory `PolicyStore`
- [ ] Gate integration updated for new `firedRules` payload
- [ ] No files exceed ~300 lines (extract helpers as needed)
- [ ] All validation commands pass

---

## Anti-Patterns to Avoid

- ❌ Keeping `PolicyMatchResult` local to `@scout/policy` (cross-package drift risk)
- ❌ Fuzzy or case-insensitive includes matching in v1
- ❌ Confidence-weighted decision override that can bypass a DENY signal
- ❌ Returning rule `match` strings in output payload
- ❌ Depending on insertion order for deterministic output
- ❌ Adding network/LLM/store dependencies inside `match()`
- ❌ Treating tenant mismatch differently from not-found in store contract behavior

---

## Confidence Score

**9/10** for one-pass implementation success.

High confidence because current code already has the relevant seams (`@scout/policy`,
`@scout/shared`, `@scout/gate`, `@scout/store`) and tests are already established with
Vitest in gate. Main residual risk is integration churn from changing
`matchedRules -> firedRules`; this is bounded to gate reason assembly and tests.
