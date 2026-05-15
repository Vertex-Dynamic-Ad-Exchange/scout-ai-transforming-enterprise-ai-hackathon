You are a senior TypeScript engineer fluent in deterministic pure-function consensus algorithms over typed multi-source verdict inputs, noisy-OR / independent-evidence confidence blending, disagreement detection that distinguishes decision-level from label-level divergence, evidence deduplication across modality-distinct sources, and the brand-safety asymmetry where a single high-confidence DENY trumps any number of low-confidence ALLOWs and where uncertainty must escalate to HUMAN_REVIEW rather than silently average.

## PRIORITY:

**P1 — warm-path-blocking for the *disagreement-driven HUMAN_REVIEW* demo moment.** Corresponds to the `agent-arbiter-scoring.md` row in `FEATURE-TODO.md:67-69` under *Cluster C — Verifier agents*. Independent of the three verifier-prompt rows (`FEATURE-TODO.md:60-66`) — arbiter consumes `AgentVerdict[]` (a typed contract), so verifier-prompt PRPs can land in any order against the foundation stubs. Until this lands, `packages/agents/arbiter/src/index.ts:1` is `export {};`; the profiler PRP (`features/clusterB/profiler-real-loop.md:69-70`) upgrades it to a factory returning a hardcoded valid `ArbiterDecision`, which means the profiler's `Promise.allSettled` fan-out commits the *same* `consensusCategories` regardless of what the three verifiers emit, the *disagreements[]* array is always empty, and the `HUMAN_REVIEW` profile path that drives Track 1's *"independent verification, not three rubber-stamps"* narrative (`features/architecture.md:50-53`) never fires on stage. The demo's *"ambiguous case → HUMAN_REVIEW arbiter disagreement"* fixture in `FEATURE-TODO.md:79-82` is exactly this PRP's surface — replayer drives gate, gate reads a profile that was arbited to `HUMAN_REVIEW`, dashboard surfaces the disagreement panel.

**Latency stakes — warm path, pure-function, ≤ 5ms p95 inside `combine()`.** Arbiter is a stage in the profiler's per-job pipeline, not on the hot path. The constraint that binds is *determinism* and *no I/O* — pure function over a small typed input. The architecture's `agents/` line at `features/architecture.md:107-111` is explicit: *"each is a pure function over a typed input → typed Verdict. No I/O outside the LLM client."* The arbiter has no LLM client; it has no I/O at all. (If a future revision adds an LLM-narrative path — see *Open questions* — that path is filed as a follow-up, not v1.)

## FEATURE:

Replace the foundation stub at `packages/agents/arbiter/src/index.ts:1` (currently `export {};`) with the real `combine(verdicts, capture, ctx) → ArbiterDecision` pure function described in `features/architecture.md:50-53` and the `Arbiter` interface seam locked by `features/clusterB/profiler-real-loop.md:70`. **Plus** lock — or consume, depending on merge order — the cross-package contracts profiler-real-loop proposes (`features/clusterB/profiler-real-loop.md:43-66`): `AgentVerdictSchema`, `ArbiterDecisionSchema`, `Verifier`, and `Arbiter` in `@scout/shared`. As of 2026-05-14, none of those exist in `packages/shared/src/index.ts:1-5` — the barrel only exports `primitives | bid | profile | policy | verdict`. Coordination point: whichever PRP lands first creates the schemas + interfaces; the second appends or no-ops. See *Other Considerations — Coordination with `profiler-real-loop.md`*.

End state:

- **New shared schema** (if not already landed by profiler-real-loop): `packages/shared/src/schemas/agentVerdict.ts` exports `AgentVerdictSchema` + `ArbiterDecisionSchema` + `DisagreementSchema`, added to the barrel. Shape (matches `features/clusterB/profiler-real-loop.md:45-65` byte-for-byte to prevent merge drift):
  ```ts
  AgentVerdict = {
    verifier: "text" | "image" | "video",
    decision: Decision,                // ALLOW | DENY | HUMAN_REVIEW
    categories: Category[],            // verifier's per-label confidences (reuse CategorySchema from packages/shared/src/schemas/profile.ts:3)
    detectedEntities: DetectedEntity[],
    evidenceRefs: EvidenceRef[],
    modelLatencyMs: number,            // int >=0
    lobstertrapTraceId: string | null, // null only on degraded no-LLM path
  }

  Disagreement = {
    kind: "decision" | "category" | "entity",
    label: string,                     // for "decision": the action that disagreed; for "category"/"entity": the label
    perVerifier: Record<"text"|"image"|"video", number>, // confidence per verifier; missing verifier → 0
  }

  ArbiterDecision = {
    decision: Decision,
    confidence: number,                // [0,1]; same scale as PolicyMatchResult.confidence so gate's ambiguity dial is consistent (features/clusterA/policy-match-evaluation.md:57)
    consensusCategories: Category[],   // labels where ≥2 verifiers agreed AND aggregated confidence ≥ floor; flows into PageProfile.categories
    consensusEntities: DetectedEntity[],
    disagreements: Disagreement[],
    humanReviewRecommended: boolean,
    lobstertrapTraceId: string | null, // null in v1 pure-function arbiter; reserved for future LLM-narrative path
    evidenceRefs: EvidenceRef[],       // consolidated + deduped from contributing verifiers; ≤ EVIDENCE_REF_CAP refs to bound dashboard payload
  }
  ```
- **New shared interface** (if not already landed): `packages/shared/src/interfaces/arbiter.ts` exports `Arbiter { combine(verdicts: AgentVerdict[], capture: PageCapture, ctx: ArbiterContext): Promise<ArbiterDecision> }`. `ArbiterContext = { advertiserId: string; policyId: string; humanReviewThreshold: number; abortSignal: AbortSignal }`. Returns `Promise<ArbiterDecision>` even though v1 is synchronous — the interface accommodates a future LLM-narrative path without breaking `profiler-real-loop`'s call site.
- **Real `combine()`**: `packages/agents/arbiter/src/combine.ts` exports the function; `packages/agents/arbiter/src/index.ts` becomes the barrel exporting `createArbiter(): Arbiter` (factory shape mirrors `@scout/llm-client` and `@scout/harness`). Body ≤ 150 lines — extract `disagreements.ts` (decision + label disagreement detection), `consensus.ts` (per-label noisy-OR aggregation + `consensusCategories` / `consensusEntities` selection), `decision.ts` (final `decision` + `humanReviewRecommended` from the disagreement + threshold inputs), and `evidence.ts` (dedupe + cap) as siblings. Each ≤ 100 lines.
- **Decision aggregation algorithm** (the load-bearing semantic — comment the *why* inline; the *what* is obvious from the code):
  - **Step 1 — Decision-level vote.** Group verifiers by their emitted `verdict.decision`. If any verifier emits `DENY` with `confidence ≥ CONFIDENCE_FLOOR` (0.1, reused from `features/clusterA/policy-match-evaluation.md:25`), arbiter's `decision = DENY` — the brand-safety asymmetry (`features/clusterA/policy-match-evaluation.md:94`) carries through: a single high-confidence DENY trumps multiple ALLOWs. (Verifier `confidence` here is the *strongest* category/entity confidence the verifier emitted under `decision`, computed in `combine.ts` from `verdict.categories`/`verdict.detectedEntities`.)
  - **Step 2 — HUMAN_REVIEW from disagreement.** If decisions disagree at the *verifier-decision level* (e.g., text=ALLOW, image=DENY, video=ALLOW) AND no DENY cleared step 1's floor, `decision = HUMAN_REVIEW`. The disagreement itself is the signal.
  - **Step 3 — Aggregated-confidence threshold.** Compute `blendedConfidence` (see below). If `decision` from steps 1–2 is `ALLOW` and `blendedConfidence < ctx.humanReviewThreshold`, escalate to `HUMAN_REVIEW`. This is what makes the threshold dial — locked on `Policy.escalation.humanReviewThreshold` per `packages/shared/src/schemas/policy.ts:14` — actually load-bearing.
  - **Step 4 — Unanimous fallthrough.** If all verifiers emit the same decision (e.g., all `ALLOW`) and step 3 didn't escalate, that decision wins; `humanReviewRecommended: false`.
  - **No silent averaging.** The architecture doc forbids it (`features/architecture.md:52`); a single 0.95-confidence DENY against two 0.6-confidence ALLOWs must DENY, not blend-to-ALLOW. The decision algorithm respects this because step 1 fires before any blending.
- **Confidence blending** — noisy-OR over the *contributing* verdicts (the ones whose `decision` matched the arbiter's final `decision`): `blendedConfidence = 1 - Π(1 - c_i)` where `c_i` is each contributing verifier's strongest in-class confidence. Same formula as `features/clusterA/policy-match-evaluation.md:100` for the same reason — multiple independent positive signals legitimately corroborate; mean dilutes; max ignores corroboration. **Inline one-line comment** with the formula and a pointer to the policy-match precedent.
- **Disagreement detection** — `disagreements[]` is populated regardless of the final decision; it is the audit-trail surface for the dashboard's *"which verifier saw what"* drill-down (`features/clusterB/profiler-real-loop.md:5`, `dashboard-verdict-views.md`):
  - **Decision disagreement** (`kind: "decision"`): emitted when any two verifiers disagree on `verdict.decision`. `label` is the disagreed-on action string (`ALLOW` / `DENY` / `HUMAN_REVIEW`); `perVerifier` maps each verifier to its strongest in-class confidence (0 if the verifier didn't emit that decision).
  - **Category disagreement** (`kind: "category"`): emitted per `label` where `max(c_i) − min(c_i) ≥ CATEGORY_DISAGREE_DELTA` (0.4) across verifiers that emitted that label. `perVerifier` maps each verifier to its `category.confidence` for that label (0 if the verifier did not emit that label).
  - **Entity disagreement** (`kind: "entity"`): same shape, applied to `detectedEntities[i].name`. **Not** `type` — entities are matched by name (consistent with `features/clusterA/policy-match-evaluation.md:60`).
  - Order: `disagreements[]` sorted lexicographically by `(kind, label)` for determinism.
- **`consensusCategories` / `consensusEntities` selection** — a category `label` enters `consensusCategories` iff:
  - ≥ 2 verifiers emitted that label, AND
  - `noisy-OR` of those verifiers' confidences ≥ `CONSENSUS_CONFIDENCE_FLOOR` (0.3). Higher than `CONFIDENCE_FLOOR` (0.1) because consensus requires more evidence than rule-fire eligibility.
  - The emitted `Category.confidence` is the noisy-OR aggregate (NOT a verifier's individual value).
  - Same rule applies to `consensusEntities` over `detectedEntities[].name`.
  - **`evidence`-only verifiers don't bias consensus**: a verifier that contributed an `evidenceRef` but no `categories[].label` does not count toward the ≥ 2 threshold.
- **`humanReviewRecommended`** — `true` iff `decision === "HUMAN_REVIEW"` OR `disagreements.some(d => d.kind === "decision")`. The second clause means even if the arbiter resolves to ALLOW/DENY on the strength of one verifier, an *operator-visible disagreement flag* is set — the dashboard's reviewer queue can use this independently of the final decision.
- **Evidence assembly** — `evidenceRefs[]` is the union of contributing verifiers' `evidenceRefs[]`, **deduplicated by `uri`** (keep first occurrence; URIs are content-hashed by the harness per `features/clusterB/harness-capture-page.md:48` so equal-URI evidence is the same evidence), capped at `EVIDENCE_REF_CAP` (12) refs. Cap eviction is FIFO over the contributing verifiers (text → image → video order — same order used by profiler's audit row at `features/clusterB/profiler-real-loop.md:264`). The dashboard's drill-down can render 12 evidence tiles without going past the fold; the cap keeps the `ArbiterDecision` payload bounded for the audit row's redis cost.
- **Determinism contract**: `combine(v, cap, ctx)` called twice with deep-equal inputs returns deep-equal outputs. `consensusCategories[]` / `consensusEntities[]` / `disagreements[]` / `evidenceRefs[]` are all in stable sorted order (lexicographic by label/name/uri). Same standard as `features/clusterA/policy-match-evaluation.md:34`. Map/Set iteration order is not portable.
- **Input pre-validation**: every `verdict` in `verdicts[]` runs through `AgentVerdictSchema.safeParse()` at function entry — a verifier that returns a malformed `AgentVerdict` is treated as a *synthetic `HUMAN_REVIEW` placeholder* (same shape profiler synthesizes on per-verifier rejection per `features/clusterB/profiler-real-loop.md:79`) rather than throwing. This is defense-in-depth: a verifier-prompt bug must not crash the pipeline; it must surface as `disagreements[]` evidence.
- **Output schema validation at boundary**: `ArbiterDecisionSchema.parse(out)` before return — defense-in-depth, same pattern as policy-match (`features/clusterA/policy-match-evaluation.md:36`) and gate (`features/clusterA/gate-verdict-logic.md:53`).
- **No I/O. No LLM. No `Date.now()`. No `Math.random()`. No `process.env`.** Same purity property as `@scout/policy`. The ESLint boundary that blocks `openai` / `@google/genai` outside `@scout/llm-client` (`PRPs/foundation-ad-verification.md:151-154`) already applies to `packages/agents/arbiter/**`; preserve it (no SDK imports, ever, in this package).
- **Tests — exhaustive matrix**, not 1/1/1, because this is brand-safety load-bearing (matches the density of `features/clusterA/policy-match-evaluation.md:40-51` and `features/clusterA/gate-verdict-logic.md:36-47`):
  - **Schema** — `AgentVerdictSchema`, `DisagreementSchema`, `ArbiterDecisionSchema` round-trip hand-built valid values. `combine()`'s output passes `ArbiterDecisionSchema.parse()`.
  - **`Arbiter` interface compile-test** — `satisfies Arbiter` on `createArbiter()`'s return. Catches contract drift at type-check time.
  - **Happy: 3 verifiers unanimous ALLOW with high confidence** → `decision: ALLOW`, `consensusCategories.length > 0` (the agreed labels), `disagreements: []`, `humanReviewRecommended: false`, `blendedConfidence ≥ humanReviewThreshold`.
  - **Happy: 3 verifiers unanimous DENY** → `decision: DENY`, `consensusCategories` includes the brand-unsafe label(s), `humanReviewRecommended: false`.
  - **Asymmetry: 1 verifier DENY @ 0.95, 2 verifiers ALLOW @ 0.6** → `decision: DENY` (step 1 fires), `disagreements[0].kind === "decision"`, `humanReviewRecommended: true`. *The high-confidence DENY trumps even though it's outvoted.* This is the brand-safety asymmetry test — flip it and the test must fail.
  - **HUMAN_REVIEW from decision disagreement: text=ALLOW, image=DENY @ 0.3 (below floor), video=ALLOW** → `decision: HUMAN_REVIEW` (step 2: disagreement without a floor-clearing DENY), `humanReviewRecommended: true`.
  - **HUMAN_REVIEW from confidence-below-threshold: 3 verifiers ALLOW but blended confidence = 0.4, `humanReviewThreshold = 0.7`** → `decision: HUMAN_REVIEW` (step 3), `humanReviewRecommended: true`. No `decision` disagreement, but the *certainty* is too low.
  - **No HUMAN_REVIEW when threshold is met: same shape with `humanReviewThreshold = 0.3`** → `decision: ALLOW`. Pins the threshold-dial semantic.
  - **Confidence floor on the DENY override: 1 verifier DENY @ 0.05 (below `CONFIDENCE_FLOOR`), 2 verifiers ALLOW @ 0.8** → `decision: ALLOW`; the sub-floor DENY does not fire step 1. `disagreements[]` still records the decision-level disagreement.
  - **Two-verifier consensus, one no-emit: text=ALLOW with category `Sports`@0.7, image=ALLOW with `Sports`@0.6, video=ALLOW with no categories** → `consensusCategories` includes `Sports` with noisy-OR aggregate `0.88` (within ε); video's no-emit does not block consensus.
  - **No consensus when only 1 verifier emits a label: text=DENY with `Gambling`@0.9, image=ALLOW (no Gambling), video=ALLOW (no Gambling)** → `decision: DENY` (step 1), but `consensusCategories` does NOT include `Gambling` (< 2 verifiers emitted). `disagreements[]` does include `{kind: "category", label: "Gambling", perVerifier: {text:0.9, image:0, video:0}}`.
  - **Category disagreement detection: `Politics` emitted by text@0.9 and image@0.1** → `disagreements` includes `{kind: "category", label: "Politics", perVerifier: {text:0.9, image:0.1, video:0}}` (delta 0.8 ≥ `CATEGORY_DISAGREE_DELTA` of 0.4).
  - **Entity disagreement parallels category disagreement** (same matrix, `kind: "entity"`).
  - **Determinism: `combine(v, c, ctx)` deep-equals `combine(structuredClone(v), structuredClone(c), ctx)` AND `combine(v, c, ctx)` called twice** — two assertions in one test, CI-cheap.
  - **`disagreements[]` lexicographic ordering** over a hand-crafted input with 6 disagreements across `kind ∈ {decision, category, entity}` × `label ∈ {A...F}`.
  - **Evidence dedupe + cap: 3 verifiers with 5 `evidenceRefs` each, several shared URIs across verifiers** → `out.evidenceRefs.length ≤ EVIDENCE_REF_CAP`, no duplicate `uri`, FIFO eviction order pinned (text-first).
  - **Malformed `AgentVerdict` synthesizes HUMAN_REVIEW placeholder**: passing a `verdict` missing `categories` (or any other required field) does NOT throw; the arbiter substitutes `{ verifier: <inferred from input position OR "text" fallback>, decision: "HUMAN_REVIEW", categories: [], detectedEntities: [], evidenceRefs: [], modelLatencyMs: 0, lobstertrapTraceId: null }` and emits `disagreements` accordingly.
  - **Empty `verdicts[]` is treated as HUMAN_REVIEW** (no signal → no consensus → escalate). `confidence: 0`, `humanReviewRecommended: true`. **Tested.**
  - **Verdict from an unknown `verifier` kind** (forward-compat shape) → safeParse rejects → synthesized HUMAN_REVIEW placeholder (same path as malformed-input).
  - **`abortSignal` already aborted at function entry** → throws an `AbortError`-shaped exception immediately. Same convention as harness/profiler. (Pure function but interface-promised `Promise<...>` and the profiler will plumb `ctx.abortSignal` through.)
  - **Determinism property test (optional, `fast-check`)**: for any zod-generated `(verdicts, capture, ctx)`, two calls produce deep-equal results. File only if CI time permits; not load-bearing.
  - **Cross-tenant scoping**: `combine()` does NOT validate `ctx.advertiserId` against `verdicts[i].evidenceRefs[j].uri` — tenant scoping is the profiler's job at commit time (`features/clusterB/profiler-real-loop.md:88-89`). Test that asserts arbiter passes evidence URIs through unchanged (no rewriting); the profiler rewrites at commit, not the arbiter.

## EXAMPLES:

- `packages/agents/arbiter/src/index.ts:1` — current `export {};` stub from foundation task 6 (`PRPs/foundation-ad-verification.md:250-252`). This PRP replaces it with a barrel exporting `createArbiter`.
- `packages/agents/arbiter/package.json` — current deps: `@scout/shared` only. This PRP adds NO new runtime deps (pure function; reuse zod from `@scout/shared`); optional `fast-check` as a `devDependency` if the property test ships.
- `packages/shared/src/schemas/profile.ts:3-7` — `CategorySchema { label, confidence }`. Reused for `AgentVerdict.categories` and `ArbiterDecision.consensusCategories`.
- `packages/shared/src/schemas/profile.ts:9-14` — `DetectedEntitySchema { name, type, confidence }`. Reused for `AgentVerdict.detectedEntities` and `ArbiterDecision.consensusEntities`. Match on `name`, not `type` (same rule as `features/clusterA/policy-match-evaluation.md:60`).
- `packages/shared/src/schemas/profile.ts:16-20` — `EvidenceRefSchema`. Reused for `AgentVerdict.evidenceRefs` and `ArbiterDecision.evidenceRefs`.
- `packages/shared/src/schemas/primitives.ts:3` — `DecisionSchema { ALLOW | DENY | HUMAN_REVIEW }`. The triple-value decision space.
- `packages/shared/src/schemas/policy.ts:12-15` — `EscalationSchema.humanReviewThreshold` ∈ [0,1]. The dial threaded into `ArbiterContext.humanReviewThreshold`. Same scale as `ArbiterDecision.confidence`; consistent with `features/clusterA/policy-match-evaluation.md:57`.
- `packages/shared/src/index.ts:1-5` — current barrel. Append `export * from "./schemas/agentVerdict.js"` + `export * from "./interfaces/arbiter.js"` (creating `interfaces/` if `harness-capture-page.md` PRP hasn't already — see *Coordination*).
- `features/architecture.md:50-53` — *"the three verdicts go to a fourth `arbiter` agent that flags disagreements. Disagreement above a threshold → `HUMAN_REVIEW` queue, not a silent average. This is what makes the system 'independent verification' rather than three rubber-stamps."* Every step of the decision algorithm above maps to one phrase here.
- `features/architecture.md:107-111` — module boundary: arbiter is one of four agents, each a *pure function over typed input → typed Verdict*. The "No I/O outside the LLM client" clause is *especially* tight here because arbiter has no LLM client at all.
- `features/clusterA/policy-match-evaluation.md:33` — noisy-OR formula precedent and rationale; the arbiter reuses the formula and the *why* unchanged.
- `features/clusterA/policy-match-evaluation.md:94` — brand-safety asymmetry; the *"single high-confidence DENY overrides ten low-confidence ALLOWs"* principle. Arbiter's step-1 logic is the verifier-side mirror of policy-match's rule-precedence.
- `features/clusterA/policy-match-evaluation.md:115` — *"No rule-match string leakage."* Equivalent rule applies here: the arbiter does NOT echo a verifier's raw category/entity *match strings* in `disagreements[]` unless they came from the verifier itself — they did, so no transformation is needed, but the rule prevents a future "let me synthesize a label" optimization from leaking advertiser-private context.
- `features/clusterB/profiler-real-loop.md:43-66` — the **authoritative** shape for `AgentVerdict` / `ArbiterDecision` / `Disagreement` that this PRP either lands or consumes (depending on merge order). Drift between this PRP's schema and that one is a merge bug; coordinate before merging.
- `features/clusterB/profiler-real-loop.md:69-70` — profiler proposes the `Arbiter` interface in `packages/shared/src/interfaces/arbiter.ts`; arbiter's `createArbiter()` factory must satisfy whatever that PRP commits.
- `features/clusterB/profiler-real-loop.md:79-81` — profiler's *per-verifier partial-failure synthetic HUMAN_REVIEW* shape. Arbiter's malformed-input handling produces the **same** synthetic value so the consensus + disagreement code paths don't fork between "verifier rejected" and "verifier returned malformed shape".
- `features/clusterB/profiler-real-loop.md:131-132` — profiler's *"any verifier trace ID null on a non-degraded job"* gate metric. Arbiter's own `lobstertrapTraceId` in v1 is *always null* (no LLM call) — coordinate so the metric correctly excludes the arbiter from the chain-completeness check, OR add an explicit `null is allowed for the arbiter slot` clause.
- `features/clusterB/profiler-real-loop.md:264` — verifier order in profiler's audit row: `["text", "image", "video", "arbiter"]`. Arbiter's `evidenceRefs[]` FIFO eviction follows the same first-three order for visual consistency in the dashboard.
- **Greenfield otherwise** — no in-repo consensus-algorithm precedent. External references in *DOCUMENTATION*.

## DOCUMENTATION:

- Noisy-OR semantics (Pearl 1988 § 4.3 is canonical; any modern probabilistic-reasoning text works). Same reference used in policy-match: <https://en.wikipedia.org/wiki/Bayesian_network#Conditional_probability_tables>
- zod `z.discriminatedUnion` — used in `DisagreementSchema` if per-`kind` payload diverges in v2 (v1 keeps a flat shape; forward pointer): <https://zod.dev/?id=discriminated-unions>
- vitest `test.each` for the decision-aggregation and consensus matrices — both are best expressed as tables: <https://vitest.dev/api/#test-each>
- fast-check property-based testing (optional, for the determinism property): <https://fast-check.dev/docs/introduction/>
- `AbortSignal.throwIfAborted` — used in the "already-aborted at entry" test to mirror harness/profiler convention: <https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/throwIfAborted>
- **Pin Gemini model IDs**: **N/A.** Arbiter is a pure function in v1; no LLM call; no model pin needed. The future LLM-narrative path (filed out-of-scope) would pin `gemini-2.5-pro` per foundation lock at `PRPs/foundation-ad-verification.md:216-217`.
- **Lobster Trap policy syntax**: **N/A.** No LLM seam to inspect.

## OTHER CONSIDERATIONS:

- **Sponsor-tech relevance: NEITHER (v1).** No Gemini call. No Lobster Trap seam. Same explicit-absence call-out as `features/clusterA/policy-match-evaluation.md:84`. The arbiter's contribution to the prize narrative is *indirect*: the *disagreement-driven HUMAN_REVIEW* moment is what makes Track 1 (Veea) judges see "this is not three rubber-stamps" — that's a *story* the arbiter enables, not a sponsor-SDK integration it performs. The verifier-prompt PRPs (Cluster C peers) are where Gemini Pro + Lobster Trap are exercised; arbiter is what makes their *disagreement* visible.

- **Coordination with `profiler-real-loop.md` (load-bearing).** Profiler's feature file claims authority to land `AgentVerdictSchema`, `ArbiterDecisionSchema`, the `Arbiter` interface, the `Verifier` interface, AND the `ProfileQueue` interface in `@scout/shared` (`features/clusterB/profiler-real-loop.md:30-71`). This arbiter PRP needs a subset (`AgentVerdictSchema`, `ArbiterDecisionSchema`, `Arbiter`). Merge order:
  - **(A) profiler-real-loop PRP merges first.** Arbiter PRP consumes the already-landed schemas + interface; no schema work in this package; `@scout/shared` barrel already exports them.
  - **(B) agent-arbiter-scoring PRP merges first.** This PRP lands `AgentVerdictSchema` + `ArbiterDecisionSchema` + `Disagreement` + `Arbiter` interface in `@scout/shared`; profiler PRP later imports them and adds the `Verifier` + `ProfileQueue` interfaces alongside.
  - **(C) Both merge concurrently.** The schemas/interfaces section duplicates → merge conflict. **Block this with a coordination note in each PR description**.
  - **Recommend: write this PRP to handle (B) — land the schemas — and add a `Reason: profiler may have landed these already` early-exit comment in the schema file so the merge handles either order without rewrite.** Same shape both ways; sequencing is a PR-coordination concern, not a re-architecting one.

- **Open question — Pure function or LLM-based arbiter?**
  - **(A) Pure function (v1).** Deterministic, ≤ 5ms p95, no Gemini Pro spend, no Lobster Trap seam, no audit-row trace ID. The architecture doc's *"flags disagreements"* phrasing fits a pure-function disagreement detector; "agent" is the package-level boundary name, not a claim that arbiter is an LLM-driven agent.
  - **(B) Gemini Pro narrative arbiter.** A fifth LLM call per profile: arbiter generates a human-readable narrative of the disagreement (*"text and image classifiers agreed the page is news, but video classifier flagged the embedded ad as gambling-adjacent…"*) for the dashboard's reviewer queue. Adds ~3-5s warm-path latency + 1 Pro call's spend + 1 Lobster Trap audit trace.
  - **Recommend (A) for v1.** Determinism + cost. The narrative is filed as a follow-up — if the Track 1 demo would benefit from a one-paragraph arbiter explanation, it can be a *post-decision* enrichment call (the arbiter's `decision` is computed pure; an optional `summary: string` field is filled by a separate LLM call only on `HUMAN_REVIEW` profiles, so cost is bounded to disputed pages only). File the LLM-narrative path as `agent-arbiter-narrative.md` (new row in `FEATURE-TODO.md` Cluster C, append at the end).

- **Open question — Decision aggregation: step 1 floor source.**
  - **(A) Hard-coded `CONFIDENCE_FLOOR = 0.1`** in `combine.ts`, reusing the policy-match constant for consistency (`features/clusterA/policy-match-evaluation.md:25`). Cross-package magic-number drift is avoided by exporting it from `@scout/shared` (new file `packages/shared/src/constants.ts`) and importing in both packages.
  - **(B) `ArbiterContext.confidenceFloor`** — per-call configurable; matches the *flexibility* of `humanReviewThreshold` but adds a knob nobody asked for.
  - **(C) Per-verifier floor** — `text` and `image` are different reliability profiles; per-modality floors.
  - **Recommend (A) with the cross-package constant.** Drift between `@scout/policy` and `@scout/agent-arbiter` on this value is a silent semantic bug — one rule fires, the other doesn't, on the same signal. Pin in `@scout/shared`.

- **Open question — `consensusCategories` minimum-verifier-count.**
  - **(A) ≥ 2 verifiers** (the v1 default above). A single verifier's high-confidence label is a *disagreement signal*, not a *consensus signal*.
  - **(B) ≥ 1 verifier with high confidence** + threshold. Simpler, but a single text-only label can drive the entire `PageProfile.categories`, which gives downstream policy match a false signal of "agreed-on category" that wasn't.
  - **(C) Weighted: 1 verifier with very-high confidence (≥ 0.9) OR 2 verifiers with moderate.**
  - **Recommend (A).** The whole point of three independent verifiers is corroboration; let solo signals appear in `disagreements[]` for the dashboard, not in `consensusCategories` for downstream `policy.match`.

- **Open question — `humanReviewRecommended` semantic relative to `decision`.**
  - **(A) `humanReviewRecommended === true` iff `decision === "HUMAN_REVIEW"`** — tight coupling; the field is redundant.
  - **(B) `humanReviewRecommended === true` iff `decision === "HUMAN_REVIEW"` OR a decision-level disagreement was observed** — even when arbiter resolves to ALLOW/DENY, the reviewer queue gets a heads-up.
  - **(C) `humanReviewRecommended` lifted to a richer enum (`none | informational | required`)**.
  - **Recommend (B).** The dashboard can use the flag independently of the final decision to prioritize disputed-but-resolved pages in the reviewer queue. The cost is one extra boolean; the value is a richer Track 1 demo surface.

- **Open question — `consensusEntities` matching: name only vs. name+type.**
  - **(A) Name only** (consistent with `features/clusterA/policy-match-evaluation.md:60`). `"Atlantic City Casino"` matches across verifiers regardless of whether one verifier typed it `"organization"` and another typed it `"location"`.
  - **(B) `(name, type)` tuple**. Stricter; misses cross-typed entities (which are common — a casino is both an organization and a location).
  - **Recommend (A).** Carries verifier-emitted `type` through into `consensusEntities[i].type` from the *first* contributing verifier (lexicographic by verifier kind, so it's deterministic), with a comment noting the choice. A future refinement could aggregate types; v1 keeps it simple.

- **Open question — `EVIDENCE_REF_CAP` value.**
  - **(A) 12** (the v1 default, 4 per modality × 3 modalities). Dashboard tiles in 3 rows of 4.
  - **(B) Per-decision cap: DENY/HUMAN_REVIEW gets 12, ALLOW gets 4** (ALLOWs don't need much evidence on stage; HUMAN_REVIEW needs everything).
  - **(C) Uncapped, let the dashboard truncate on read.**
  - **Recommend (A).** Bounded payload, predictable cost, no policy embedded in the data model. Dashboard caps are an *additional* defense (`dashboard-verdict-views.md` will probably do its own truncation).

- **Open question — `lobstertrapTraceId` on `ArbiterDecision` and profiler's chain-completeness check.**
  - **(A) `lobstertrapTraceId: null` always in v1 + update profiler's chain-completeness rule** (`features/clusterB/profiler-real-loop.md:131-132`) to require non-null only for verifier slots, not arbiter.
  - **(B) Remove `lobstertrapTraceId` from `ArbiterDecisionSchema` entirely** — cleaner, but breaks the audit row's symmetric shape and breaks the future LLM-narrative path's drop-in addition.
  - **Recommend (A).** Keep the field for forward-compat; pin the rule on the profiler side via a coordination note in this PRP's *Coordination* section above.

- **Security guardrails:**
  - **Purity is the security property.** No env access, no I/O, no global state, no `Date.now()` (a clock dependency would break determinism). Verified by the same kind of test as policy-match (`features/clusterA/policy-match-evaluation.md:114`): import `@scout/agent-arbiter` with `vi.spyOn(process, "env", "get")` and assert zero accesses across the test suite. The ESLint boundary already blocks `openai` / `@google/genai` imports here (`PRPs/foundation-ad-verification.md:151-154`).
  - **No advertiser-private content leaks across verifiers.** `disagreements[i].perVerifier` exposes one verifier's confidence to the dashboard; tenancy scope is *advertiser-level* (a verifier's confidence on `Gambling` is observable by the advertiser whose policy triggered the profile, not by other advertisers). Arbiter does not enforce this — the dashboard does (`dashboard-verdict-views.md`). But arbiter MUST NOT echo `ctx.advertiserId` or `ctx.policyId` into any `disagreement.label` or `evidenceRef.uri`; do not interpolate.
  - **Evidence URIs pass through unchanged.** Profiler rewrites URIs at commit time per `features/clusterB/profiler-real-loop.md:88-89`; arbiter does NOT prefix or transform them. A test pins the property (input URI X → output URI X). A future "the arbiter knows the advertiser, why not prefix" optimization is the bug this rule prevents.
  - **Fail-closed on malformed input.** A verifier returning a malformed `AgentVerdict` synthesizes a `HUMAN_REVIEW` placeholder, NOT a default-ALLOW. Same asymmetry as `gate-verdict-logic.md:103`.
  - **Schema-validate the output**: `ArbiterDecisionSchema.parse(out)` immediately before return. A bug that fabricates a shape the profiler later rejects becomes an observable error, not a silent invalid commit.
  - **Bounded payload (`EVIDENCE_REF_CAP`, `disagreements[]` natural-bounded by category/entity count).** Prevents a hostile verifier-prompt regression from emitting 10,000 categories that bloat the audit row.

- **Gotchas:**
  - **Floating-point determinism on noisy-OR.** `1 - (1 - 0.5) * (1 - 0.5) = 0.75` is IEEE-754-exact; `[0.1, 0.2, 0.3]` is not. Tests use `toBeCloseTo(x, 6)`, not `toBe(x)`. Same gotcha as `features/clusterA/policy-match-evaluation.md:125`.
  - **`Map`/`Set` iteration order is not portable across V8 versions on adversarial keys.** Sort `consensusCategories` / `consensusEntities` / `disagreements` / `evidenceRefs` by stable key before returning. Same gotcha as `features/clusterA/policy-match-evaluation.md:121`.
  - **`verdict.verifier` is the *enum*, not a free-form string.** `AgentVerdictSchema` enforces `"text" | "image" | "video"` — a malformed `verdict.verifier: "arbiter"` (a hostile / buggy verifier impersonating the arbiter) parses-fail and synthesizes a placeholder. Test this specifically.
  - **Empty `verdicts[]` is legal at the *interface* but unusual at the *profiler* call site.** Profiler always invokes arbiter with at least one verdict (synthesizing HUMAN_REVIEW for failed verifiers per `features/clusterB/profiler-real-loop.md:79`); but the arbiter MUST handle `verdicts: []` cleanly because (a) the profiler PRP may merge later and (b) the interface contract permits it. Test pins `decision: HUMAN_REVIEW`, `confidence: 0`, `humanReviewRecommended: true`.
  - **`CONFIDENCE_FLOOR` lives in `@scout/shared/src/constants.ts`** (per the *Open question* recommendation above) — if this PRP creates that file, the policy-match PRP must coordinate to import from it on its next pass (it currently inlines `0.1`). File a follow-up if policy-match has merged with the inline constant.
  - **`humanReviewThreshold` and `ArbiterDecision.confidence` are on the same scale, with the same noisy-OR semantics.** A future change to the formula in *either* package must change *both*; the cross-package constant (`CONFIDENCE_FLOOR`) is the same idea. Add a one-line comment in `decision.ts` noting the cross-package coupling so a future reader doesn't refactor one in isolation.
  - **`consensusCategories[i].confidence` is the *noisy-OR aggregate*, not any individual verifier's `confidence`.** A test asserts: text emits `Sports@0.7`, image emits `Sports@0.6`, consensus is `Sports@0.88` (within ε), not `Sports@0.7` (max) and not `Sports@0.65` (mean). Same as the noisy-OR test in policy-match.
  - **`AgentVerdict.modelLatencyMs` is informational only in the arbiter.** Arbiter does not use it for decision-making; it flows through to `ArbiterDecision` indirectly via the profiler's audit row, not via `ArbiterDecision` itself. (Profiler's cost-tripwire reads `verdict.modelLatencyMs` at the fanout boundary per `features/clusterB/profiler-real-loop.md:100`.) Document so the next reviewer doesn't add a `lowest_latency_wins` heuristic.
  - **`AbortSignal` plumbing.** Even though v1 is pure-function and finishes in <5ms, `ctx.abortSignal.throwIfAborted()` at function entry is required for interface conformance — profiler plumbs the signal in (`features/clusterB/profiler-real-loop.md:81`), and an aborted-at-entry test pins the behavior. Cost is one method call.
  - **`verdicts[i].evidenceRefs[j].kind` set: `screenshot | dom_snippet | video_frame`** (per `packages/shared/src/schemas/profile.ts:17`). Arbiter passes `kind` through unchanged — does NOT remap `dom_snippet` → `screenshot` to "normalize" the dashboard.

- **Out of scope — file as follow-ups:**
  - **LLM-narrative arbiter** (the option-(B) path above). New row `agent-arbiter-narrative.md` in `FEATURE-TODO.md` Cluster C.
  - **Per-modality confidence floors** (option-(C) above) — requires per-verifier reliability data we don't have.
  - **Per-decision evidence cap** (option-(B) above) — bounded payload v1 default is fine for the demo.
  - **Cross-tenant evidence URI prefixing in the arbiter** — that's profiler's job; do not pull it in.
  - **`AgentVerdict` revisions** (e.g., adding `narrative: string`, `tokenCost: number`) — file as Cluster C verifier-prompt PRPs' responsibility, not arbiter's.
  - **Property-based testing across the full decision space** — file if vitest CI time permits; not load-bearing.
  - **Migrating `CONFIDENCE_FLOOR` out of policy-match's inline constant** — coordinate with `features/clusterA/policy-match-evaluation.md` follow-up.

- **Test order:**
  1. `AgentVerdictSchema` + `DisagreementSchema` + `ArbiterDecisionSchema` shape tests first (no `combine()` call; pins the contracts).
  2. `Arbiter` interface compile-test (`satisfies Arbiter` on `createArbiter()`).
  3. Unanimous-ALLOW happy path (smallest pipeline; proves the wiring).
  4. Unanimous-DENY happy path.
  5. Brand-safety asymmetry: 1 high-conf DENY vs. 2 ALLOWs (step 1 firing).
  6. Confidence floor on DENY override (sub-floor DENY does not fire step 1).
  7. Decision-level disagreement → HUMAN_REVIEW (step 2).
  8. Below-threshold → HUMAN_REVIEW (step 3).
  9. Above-threshold → no escalation (threshold dial).
  10. Consensus selection: ≥ 2 verifiers + floor.
  11. No consensus on solo signals.
  12. Category disagreement detection (delta threshold).
  13. Entity disagreement detection.
  14. Determinism (deep-equal × 2 in one test).
  15. `disagreements[]` lexicographic ordering.
  16. Evidence dedupe + cap + FIFO eviction.
  17. Malformed `AgentVerdict` → synthesized HUMAN_REVIEW placeholder.
  18. Empty `verdicts[]` → HUMAN_REVIEW.
  19. Aborted `ctx.abortSignal` at entry → throws.
  20. Cross-tenant URI pass-through (no rewrite).
  21. Determinism property test (optional, `fast-check`). Last because it's the most expensive.
