You are a senior TypeScript engineer fluent in deterministic pure-function rule engines, zod schema design at cross-package boundaries, table-driven and property-based testing in vitest, and multi-tenant isolation semantics for ad-tech policy systems where a wrong ALLOW is materially worse than a wrong DENY.

## PRIORITY:

**P0 — hot-path-critical, but indirect.** Corresponds to the `policy-match-evaluation.md` row in `FEATURE-TODO.md` under *Cluster A — Hot path*. Independent of every other engineering row (`FEATURE-TODO.md:42`). Also folds in the *Tenant isolation smoke test* cross-cutting validation (`FEATURE-TODO.md:99-100`). Until this lands, `@scout/policy.match()` returns the foundation stub's hardcoded `PolicyMatchResult` (`PRPs/foundation-ad-verification.md:246-249`), which means the gate's *clear-cut vs. ambiguous* branch in `features/gate-verdict-logic.md:79-83` is decided by a constant — every input takes the same path, so the Flash escalation path is untestable and the brand-safety story is decorative. Latency stakes: `policy.match` consumes **≤ 1ms p95** inside gate's hot-path budget (`features/gate-verdict-logic.md:32`). Pure function over small arrays; the constraint binds only if someone accidentally introduces I/O.

## FEATURE:

Replace the foundation stub at `packages/policy/src/index.ts:1` (currently `export {};`) with the real `match(profile, policy) → PolicyMatchResult` rule evaluator described in `features/architecture.md:117-119`, **plus** lock the `PolicyMatchResult` contract in `@scout/shared` (foundation hand-waves the shape; this PRP pins it). Pure, versioned, deterministic. No I/O. No LLM. No `Date.now()`, no `Math.random()`, no `process.env`.

End state:

- **New shared schema**: `packages/shared/src/schemas/match.ts` exports `PolicyMatchResultSchema` + `FiredRuleSchema`, added to the barrel at `packages/shared/src/index.ts`. Shape:
  ```ts
  PolicyMatchResult = {
    decision: Decision,              // ALLOW | DENY | HUMAN_REVIEW
    confidence: number,              // [0,1] — strength of evidence behind `decision`
    firedRules: FiredRule[],         // [{ ruleId, kind, signalConfidence }]
    policyVersion: string,           // verbatim from policy.version (audit replay)
  }
  ```
  `firedRules[]` echoes `rule.id` and the matching signal's confidence — **never the rule's `match` string**, which may be advertiser-private. Gate reconstructs human-readable `Reason.detail` from `rule.id` against the advertiser's own policy.
- **Real `match()`**: `packages/policy/src/match.ts` exports `match(profile: PageProfile, policy: Policy): PolicyMatchResult`. `packages/policy/src/index.ts` becomes the barrel. Body ≤ 150 lines — extract `aggregateConfidence.ts` and `evaluators.ts` (one evaluator per `PolicyRule.kind`) as siblings.
- **Rule evaluation** — three evaluators, one per `PolicyRule.kind` (`packages/shared/src/schemas/policy.ts:6`):
  - `category`: fires when any `profile.categories[i].label === rule.match` and `confidence ≥ CONFIDENCE_FLOOR` (0.1).
  - `entity`: fires when any `profile.detectedEntities[i].name === rule.match` and `confidence ≥ CONFIDENCE_FLOOR`.
  - `creative_tag`: **always returns no-fire today** — `PageProfile` carries no `creativeTags` field (`packages/shared/src/schemas/profile.ts:22-31`). Documented as a foundation gap; see *Out of scope*.
- **Decision precedence** (strict fail-closed, *not* a weighted average — architecture.md:52 forbids silent averaging):
  - Any `firedRule.action === "DENY"` → `decision: DENY`.
  - Else any `firedRule.action === "HUMAN_REVIEW"` → `decision: HUMAN_REVIEW`.
  - Else any `firedRule.action === "ALLOW"` → `decision: ALLOW`.
  - No rule fires → `decision: policy.escalation.ambiguousAction`, `confidence: 0`, `firedRules: []`. This is the *gate-asks-Flash-or-HUMAN_REVIEW* path that `features/gate-verdict-logic.md:24` depends on.
- **Confidence aggregation** — noisy-OR over signal confidences of the rules that drove the winning decision: `confidence = 1 - Π(1 - c_i)`. Comment the formula inline (one line); the *why* is non-obvious. Mean would dilute strong-but-narrow evidence; max ignores corroboration; noisy-OR is the standard combination of independent positive signals.
- **Determinism contract**: `match(profile, policy)` called twice with deep-equal inputs returns deep-equal outputs. `firedRules[]` ordered by `rule.id` lexicographically (Map/Set iteration order is *not* portable across V8 versions on adversarial keys).
- **Versioning**: `result.policyVersion === policy.version`, byte-for-byte. Audit replay (`features/architecture.md:35`) reconstructs the verdict by re-running `match()` against the cached profile and the policy-at-that-version; the field is the join key.
- **Output schema validation at the function boundary**: `PolicyMatchResultSchema.parse(out)` before return — defense-in-depth against shape drift while gate is the only consumer.
- **Tenant isolation contract test** (folded in per `FEATURE-TODO.md:99-100`): `packages/policy/src/__tests__/tenant-isolation.contract.test.ts` exercises the **`@scout/store` in-memory `PolicyStore`** impl. Asserts: storing policy P (advertiser A) and calling `policyStore.get(P.id, "advertiserB")` returns `undefined` — *not* P, *not* a "not found" that distinguishes "wrong tenant" from "no such policy" (those two cases must be indistinguishable to a caller, or an adversary can enumerate IDs across tenants — same property gate relies on at `features/gate-verdict-logic.md:102`). This test is a contract test, not a unit test on `@scout/policy` per se — it pins the property the *store* must hold and that *every store impl* (memory, Redis) must satisfy.
- **Example advertiser-policy fixtures**: `packages/policy/fixtures/{brand-safe-news,gambling-strict,permissive-baseline}.json` (JSON, not YAML — `policies/lobstertrap.yaml` is Lobster Trap's own config, a different surface; advertiser policies are program-loaded fixtures here, not the Veea-side policy file). Each fixture is a valid `Policy` that round-trips through `PolicySchema.parse`. Tests load fixtures via filesystem read; fixtures double as seed data for `@scout/scripts/seedPolicies` (foundation task 9, `PRPs/foundation-ad-verification.md:262-265`) — coordinate filenames with that script so the seed step picks them up without an extra index file.
- **Tests — exhaustive matrix**, not 1/1/1, because this is brand-safety load-bearing (mirrors gate's exhaustive matrix at `features/gate-verdict-logic.md:36-47`):
  - Output schema: every branch produces a value that `PolicyMatchResultSchema.parse()` accepts.
  - Single rule fires — one test per `(kind ∈ {category, entity}) × (action ∈ {ALLOW, DENY, HUMAN_REVIEW})` = 6.
  - Multi-rule precedence: DENY beats HUMAN_REVIEW beats ALLOW (3 tests covering the two transitions + the all-ALLOW happy case).
  - No rule fires + each of the three `ambiguousAction` values (3 tests).
  - Confidence floor: signal at `c=0.09` does **not** fire; `c=0.11` **does** (boundary test).
  - Noisy-OR: two firing rules with confidences `[0.5, 0.5]` → result confidence `0.75` (within ε). Pinned numeric, not "approximately."
  - Determinism: `match(p, π)` deep-equals `match(structuredClone(p), structuredClone(π))` and `match(p, π)` again. Run twice in the same test to keep CI cheap.
  - `firedRules[]` ordered by `ruleId` lexicographically across 5+ randomly-named rules.
  - `creative_tag` rule with a matching string in `profile.categories` does **not** fire (kind-correctness, not just string-match).
  - Tenant isolation contract: cross-tenant `PolicyStore.get` returns `undefined` against the in-memory impl (the test fixture from foundation task 4 — `PRPs/foundation-ad-verification.md:243-245` — runs the same suite against both impls; this PRP only adds the new case).
  - Determinism property (optional, `fast-check`): for any zod-generated `(profile, policy)`, two calls produce deep-equal results.

## EXAMPLES:

- `packages/policy/src/index.ts:1` — current `export {};` stub from foundation task 5 (`PRPs/foundation-ad-verification.md:246-249`). This PRP replaces it.
- `packages/policy/package.json:9` — package exports `.` from `./src/index.ts`; keep the barrel pattern, do not invent subpath exports.
- `packages/shared/src/schemas/policy.ts:4` — `PolicyRuleSchema`; the `kind` enum `category | entity | creative_tag` is exhaustively dispatched by the evaluator switch.
- `packages/shared/src/schemas/policy.ts:12-15` — `EscalationSchema.humanReviewThreshold` ∈ [0,1] is the dial gate compares `PolicyMatchResult.confidence` against (`features/gate-verdict-logic.md:79-83`). This PRP's `confidence` field must be on the same scale.
- `packages/shared/src/schemas/policy.ts:18` — `PolicySchema`; `match()`'s second argument. `policy.version` is `string.min(1)` — copied into output verbatim, not parsed as semver.
- `packages/shared/src/schemas/profile.ts:3` — `CategorySchema { label, confidence }`; the `category`-kind evaluator iterates `profile.categories`.
- `packages/shared/src/schemas/profile.ts:9` — `DetectedEntitySchema { name, type, confidence }`; the `entity`-kind evaluator iterates `profile.detectedEntities` and matches on `name`. **Not** `type` — `rule.match` is the entity name (e.g., "Atlantic City Casino"), not its type ("organization").
- `packages/shared/src/schemas/profile.ts:22` — `PageProfileSchema`; `match()`'s first argument. Note no `creativeTags` field — the `creative_tag` evaluator's no-fire branch derives from this.
- `packages/shared/src/schemas/primitives.ts:3` — `DecisionSchema { ALLOW | DENY | HUMAN_REVIEW }`; the `action` on `PolicyRule` and the output `decision`.
- `packages/shared/src/schemas/verdict.ts:4-9` — `ReasonSchema.kind` includes `"policy_rule"`; gate constructs `Reason{ kind: "policy_rule", ref: firedRule.ruleId, detail: ... }` from `PolicyMatchResult.firedRules[]`. This PRP's output shape must make that reconstruction cheap (rule id, not match string).
- `packages/shared/src/index.ts` — current barrel; add `PolicyMatchResultSchema`/`FiredRuleSchema` + their types here.
- `packages/store/src/index.ts:1` — foundation lands the `PolicyStore` interface and an in-memory impl (`PRPs/foundation-ad-verification.md:243-245`). The tenant-isolation contract test imports the in-memory impl from this barrel as a test dependency, **not** as a runtime dependency of `@scout/policy`. (Adding `@scout/store` to `@scout/policy`'s runtime `dependencies` would couple two seams the architecture keeps separate at `features/architecture.md:117-127`.)
- `features/gate-verdict-logic.md:24-28` — the four verdict branches gate produces; each is a different shape of `PolicyMatchResult` arriving at gate's handler. `match()` must produce all four shapes naturally.
- `features/gate-verdict-logic.md:79-83` — gate's locked answer to "what counts as ambiguous" — `confidence < humanReviewThreshold`. This PRP produces `confidence`; do not invent a parallel "ambiguity" flag.
- `features/architecture.md:33` — "pure-function rule evaluation against the cached profile … no I/O. Sub-millisecond." This PRP holds that line.
- `features/architecture.md:151` — "an advertiser can't see another advertiser's policies or verdicts. Tenant isolation in `policy/` and `store/` from day one — no shared global rules table." The tenant-isolation contract test is the executable form of this rule.
- `features/wire-chatbox-to-seller-agent-server.md` — feature-file density/shape reference (per `/create-feature` skill).
- **Greenfield otherwise** — no in-repo rule-engine precedent. Closest external references in the *DOCUMENTATION* section.

## DOCUMENTATION:

- IAB Content Taxonomy v3 — the vocabulary that production `profile.categories[i].label` and `rule.match` strings would draw from. We do not implement taxonomy hierarchy in v1 (see *Out of scope*), but the test fixtures' label strings should be plausible IAB v3 category names so the demo doesn't read as toy: <https://iabtechlab.com/standards/content-taxonomy/>
- zod `z.discriminatedUnion` — for `FiredRule` if/when the per-kind payload diverges; v1 keeps a flat shape, so this is a forward pointer, not a v1 requirement: <https://zod.dev/?id=discriminated-unions>
- vitest `test.each` for table-driven tests — the rule-precedence and noisy-OR cases are best expressed as tables, not individual `test()` blocks: <https://vitest.dev/api/#test-each>
- fast-check property-based testing (optional — only for the determinism property): <https://fast-check.dev/docs/introduction/>
- Noisy-OR semantics — the standard "combine independent positive signals" formula used here. Brief reference (Pearl 1988 § 4.3 is the canonical source; any modern probabilistic-reasoning text works): <https://en.wikipedia.org/wiki/Bayesian_network#Conditional_probability_tables>
- Pin Gemini model IDs and Lobster Trap policy syntax — **N/A for this feature**. No LLM call; no `lobstertrap.yaml` interaction. This package is the *only* hot-path module that touches neither sponsor SDK directly.

## OTHER CONSIDERATIONS:

- **Sponsor-tech relevance: NEITHER.** Pure rule evaluation, no LLM, no DPI seam. Called out per the `/create-feature` skill checklist so the absence is explicit, not assumed. The Veea and Gemini stories live in `gate-verdict-logic.md` (Flash escalation + `lobstertrapTraceId`) and the Cluster-C verifier rows; this PRP's role is to *produce the signal* that triggers the Flash call. That's the contribution to the prize narrative.

- **Open question — where does `PolicyMatchResult` live?**
  - **(A) `packages/shared/src/schemas/match.ts`, exported from the `@scout/shared` barrel.** Cross-package contract (policy emits, gate consumes); CLAUDE.md § Stack pins cross-cutting shapes to `@scout/shared`.
  - **(B) Inside `@scout/policy`, re-exported by gate from there.** Cheaper now; breaks the rule.
  - **Recommend (A).** Foundation already pins the four shapes (`BidVerificationRequest`, `PageProfile`, `Policy`, `VerificationVerdict`) in `@scout/shared`; `PolicyMatchResult` is the fifth cross-package shape and belongs in the same place. Cost: one new file + one barrel line.

- **Open question — decision precedence on multi-rule fire.**
  - **(A) Strict fail-closed**: DENY > HUMAN_REVIEW > ALLOW, regardless of confidences.
  - **(B) Confidence-weighted**: each action's summed signal confidence races; highest wins.
  - **Recommend (A).** Architecture doc explicitly forbids silent averaging (`features/architecture.md:52`) — the same principle: a single high-confidence DENY signal must override ten low-confidence ALLOW signals. Brand-safety asymmetry: a wrong DENY costs an impression; a wrong ALLOW costs an advertiser's brand. Optimize for the second.

- **Open question — confidence aggregation for the gate's ambiguity check.**
  - **(A) `max`** of signal confidences over fired rules of the winning action.
  - **(B) `noisy-OR`**: `1 - Π(1 - c_i)` over fired-rule signal confidences.
  - **(C) `mean`**.
  - **Recommend (B).** Multiple weak corroborating signals legitimately aggregate to high confidence (two 0.5 signals → 0.75); `max` ignores corroboration, `mean` dilutes strong-but-narrow evidence. Inline one-line comment in `aggregateConfidence.ts` so the reviewer can audit the math without spelunking.

- **Open question — rule matching semantics.**
  - **(A) Exact string equality** on `rule.match` vs. `category.label` / `entity.name`.
  - **(B) Glob/regex.**
  - **(C) IAB-taxonomy-aware hierarchy** (a rule matching `IAB7-39` also matches its children).
  - **Recommend (A) for v1.** Glob/regex lets an advertiser write `.*` and DENY everything (or write a catastrophic-backtracking pattern that breaks the ≤1ms budget). Taxonomy hierarchy is a real production need but requires a vocabulary file and tree-traversal — file as follow-up.

- **Open question — confidence floor.**
  - **(A) Hard-coded `CONFIDENCE_FLOOR = 0.1`** in `@scout/policy`. Signals below the floor are ignored when deciding whether a rule fires.
  - **(B) Add `Policy.escalation.confidenceFloor` to `PolicySchema`.** Per-advertiser tunable.
  - **Recommend (A).** `PolicySchema` is foundation-locked (`PRPs/foundation-ad-verification.md:114, 246-249`); changing it is a re-lock that should not piggyback on this PRP. Document the constant + the upgrade path in code; file (B) as a follow-up.

- **Security guardrails:**
  - **Purity is the security property.** `match` reads no env, makes no I/O call, allocates no global state. Verified by a test that imports `@scout/policy` with `vi.spyOn(process, "env", "get")` and asserts zero accesses across the test suite — and by the ESLint boundary in foundation task 3 that this package's imports list is `@scout/shared` only.
  - **No rule-match string leakage.** `firedRules[i]` carries `ruleId` and `signalConfidence` only. The raw `rule.match` may encode an advertiser's competitive signal (e.g., `match: "Brand-X-Lawsuit"` in a competitor's policy reveals their concerns); echoing it through to gate's `Reason.detail` would surface it in audit logs visible across the dashboard tenancy boundary. Reconstruct human-readable detail in gate, from the policy gate already holds.
  - **Tenant isolation is a store property, not a `match` property.** `match` is given a `Policy` — it does not validate that the policy belongs to the requesting advertiser; the store layer does (gate calls `PolicyStore.get(policyId, advertiserId)`). The contract test in this PRP pins that property at the store boundary; do **not** add a tenant check inside `match()` (gate already has the data to do it; doing it twice fans out the surface).
  - **Schema-validate the output**: `PolicyMatchResultSchema.parse(result)` immediately before return. A bug that fabricates a shape gate's zod parse would later reject silently turns into a 500 instead of an ALLOW; fail-closed by design.

- **Gotchas:**
  - **`policy.version` is an opaque string.** Do not parse it as semver and do not normalize it. Audit replay assumes byte-for-byte equality.
  - **Map/Set iteration order is not portable.** Sort `firedRules[]` by `ruleId` before returning; sort the *rules* before iterating if any code path depends on first-fire. Tests pin the order and will break on V8-version upgrades otherwise.
  - **`PageProfile.categories[i].label` and `rule.match` are both `string.min(1)`** — neither is normalized (case, whitespace, unicode). v1 matches with `===`; document the upgrade path to Unicode-normalized comparison as a follow-up. A demo fixture with `"Gambling"` vs. `"gambling"` *will* silently miss.
  - **`creative_tag` rule kind is currently a no-op.** `PageProfile` has no `creativeTags` field (`packages/shared/src/schemas/profile.ts:22-31`). Document this in `match.ts` as a one-line comment so the next reader doesn't waste 20 minutes looking for the evaluator. Surface to the team if any demo policy fixture relies on it (it shouldn't — but if `lobstertrap-policy-authoring.md` later wants to align rule kinds, this is the gap to close).
  - **Confidence floor `0.1` is a magic number** with semantic weight (it's the threshold below which a text/vision classifier's output is treated as noise). Export it as `CONFIDENCE_FLOOR` from `match.ts` so tests pin to the same constant the implementation uses; do not re-declare `0.1` in three places.
  - **Floating-point equality on noisy-OR.** `1 - (1 - 0.5) * (1 - 0.5) = 0.75` exactly in IEEE 754, but `[0.1, 0.2, 0.3, 0.4]` is not exact. Tests use `toBeCloseTo(x, 6)`, not `toBe(x)`.
  - **Empty `policy.rules` is legal.** `PolicySchema` does not require a non-empty array. With no rules, no rule fires → `decision = policy.escalation.ambiguousAction`, `confidence = 0`. Test this.
  - **Determinism includes `firedRules[]` ordering.** A future reviewer who adds a "iterate via `for ... of Set`" optimization will silently break determinism; the determinism property test is what catches that.
  - **Adding `@scout/store` as a `devDependencies` of `@scout/policy`** for the tenant-isolation contract test is allowed (it's a test dep, not a runtime dep); the ESLint boundary from foundation task 3 (`PRPs/foundation-ad-verification.md:147-159`) does **not** block this — verify in a smoke commit before pushing.

- **Out of scope — file as follow-ups:**
  - IAB-taxonomy-aware hierarchical matching (a rule on `IAB7` matches children `IAB7-1`, `IAB7-2`, …).
  - Glob/regex rule semantics.
  - Per-advertiser `confidenceFloor` on `PolicySchema` (requires foundation-lock revisit).
  - `creativeTags` field on `PageProfile` (needs the Harness PRP `harness-capture-page.md` to extract them; until then the `creative_tag` rule kind is dead).
  - Real `PolicyStore` redis impl beyond the in-memory contract test (foundation lands it; demo doesn't strictly need it if memory impl suffices).
  - Unicode/case normalization on match strings.
  - Performance benchmark — pure function on ≤100-rule policies and ≤50-category profiles, ≤1ms p95 trivially holds. Add a perf test only if gate's bench (`features/gate-verdict-logic.md:35`) regresses and `policy.match` shows up in the flame graph.

- **Test order:**
  1. `PolicyMatchResultSchema` shape tests first (no `match()` call; pins the contract; lets every later test rely on `parse()` for validation).
  2. Output-schema-conformance test on `match()` for one trivially-firing input (smallest pipeline; proves the wiring).
  3. Single-rule-fires matrix (6 cases, table-driven).
  4. Decision-precedence matrix (3 cases).
  5. No-fire + `ambiguousAction` (3 cases).
  6. Confidence-floor boundary (2 cases).
  7. Noisy-OR aggregation (table-driven, `toBeCloseTo`).
  8. Determinism (deep-equal twice in one test).
  9. `firedRules[]` lexicographic ordering.
  10. `creative_tag` no-fire even on a matching string in `profile.categories`.
  11. Tenant-isolation contract test (new file, runs against `@scout/store` in-memory impl). Last because it's the cross-package one — every other test is hermetic to `@scout/policy`.
