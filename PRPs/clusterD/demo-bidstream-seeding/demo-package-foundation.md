name: "Demo Bidstream Seeding — PRP-A: @scout/demo package foundation + recording-format contracts (TDD)"
description: |

  First of five PRPs implementing `features/clusterD/demo-bidstream-seeding.md`.
  Lands the `@scout/demo` workspace package skeleton, the recording-format zod
  schemas (`ScenarioSchema`, `RecordedBidSchema`, `ExpectationSchema`,
  `SeedsSchema`) with `formatVersion: "1.0"` refusal-on-unknown, the
  `DEMO_GATE_URL` config module, and `fixtures/README.md`. Source: feature
  file lines 56–67 (file paths), 119–146 (recording format), 180–198 (security
  + gotchas). NO replayer body, NO seeder body, NO scenario fixtures, NO
  scripts — those land in PRP-B (`replayer.ts`/`seeder.ts`/`asserts.ts`/
  in-process gate), PRP-C (scenarios 1+2 + `runScenario` + orchestrator),
  PRP-D (scenarios 3+4 + LLM mock + `--llm=real|mock`), PRP-E (scenarios 5+6
  + `waitForProfile` + `assertHitRate` + CI sweep).

  ## TDD discipline

  Every task is **red → green → refactor**: write the test first, confirm
  it fails for the *expected reason* (`TS2307` / `ERR_MODULE_NOT_FOUND`
  on imports; `ZodError` with the specific zod-path on schema cases),
  write minimum impl, refactor (`pnpm -r exec tsc --noEmit` + `eslint
  --fix`). Commit at green; never at red unless `WIP — red`. Schemas
  tempt "just type it out" — four downstream PRPs author fixtures
  against these contracts; a missed edge means a stage-time silent fail.

  ## Why this PRP exists separately

  - **Unblocks PRPs B–E in parallel.** PRP-B consumes `ScenarioSchema`;
    PRP-C / PRP-D / PRP-E author `fixtures/scenarios/*.json` against it.
    None can land until the format is frozen.
  - **Foundation greenfield.** `packages/demo/` does not yet exist; a
    single PRP that defines package shape + workspace wiring + barrel
    beats three PRPs each touching `package.json`.
  - **Precedent.** `PRPs/clusterB/profiler-real-loop/profiler-contracts.md`
    + `PRPs/clusterB/harness-contracts.md` both split contracts-first.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A. Compile-time + JSON-parse-time only;
    replayer is *external* to the gate per feature file line 11.
  - **Pre-bid** — Honored. Replayer drives `POST /verify` from outside.
  - **Plug-and-play** — This PRP *is* the format seam (feature line 70).
    `ScenarioSchema` is the contract; `formatVersion: "1.0"` frozen.
  - **Sponsor tech** — N/A here. No LLM call originates in this PRP;
    PRP-D + PRP-E exercise Gemini + Lobster Trap by driving traffic.

  ## CLAUDE.md rules that bite

  § Stack: zod at every cross-package contract — `ScenarioSchema` is
  one (`@scout/demo` reads fixtures; PRPs C–E author them). § Working
  agreements: files ≤ ~300 lines (each new file targets ≤ 100). No
  `process.env.*` outside `config.ts` (feature line 185). No secrets in
  fixtures (feature line 181) — grep gate below.

  ## Decisions (locked here)

  | # | Question | Locked answer |
  |---|---|---|
  | D1 | Recording format choice | **Custom JSON** per feature lines 123–139. HAR (line 122) deferred as overkill for 5 scenarios. |
  | D2 | `formatVersion` | `z.literal("1.0")`. Refusal-on-unknown is the property the replayer guarantees (feature gotcha 193). Literal — not `z.string()` — so `"0.9"` / `"1.1"` / absent all fail. |
  | D3 | Bid round-trip | `bids[i].request` parsed by `BidVerificationRequestSchema` (`packages/shared/src/schemas/bid.ts:3`) inside `loadScenario`. `RecordedBidSchema.request` is `z.unknown()` so the *schema* file stays decoupled; deep-parse in `loadScenario`. |
  | D4 | Verdict round-trip | `expectations[i]` parsed by `VerificationVerdictSchema.partial()` (`packages/shared/src/schemas/verdict.ts:11`). Partial because scenarios assert subsets; `profileId` is gate-generated and never fixture-asserted. |
  | D5 | `delayMs` semantics | **From scenario start.** Simpler for fixture authors; PRP-B's replayer sleeps `delayMs - (now - scenarioStart)`. `z.number().int().nonnegative()` — `0` accepted, `-1`/`1.5` rejected. |
  | D6 | `expectations[]` length | **One-to-one with `bids[]`.** `expectations[i]` asserts `bids[i]`. Same-length invariant via `ScenarioSchema.refine`. |
  | D7 | `latencyMsMax` shape | `z.number().int().positive()`. `0`/negative rejected. |
  | D8 | `lobstertrapTraceIdNullable` | `z.boolean()` — explicit "null vs non-null string" signal. Exact trace ID is non-deterministic; only its presence is. |
  | D9 | `reasonKinds` shape | `z.array(z.enum([...]))` mirroring `ReasonSchema.kind` (`packages/shared/src/schemas/verdict.ts:5`). Assertion is set-equality (PRP-B owns the assert). |
  | D10 | `DEMO_GATE_URL` default | `"http://localhost:3000"`. Override via `process.env.DEMO_GATE_URL`. Invalid URL throws at read (defense in depth). Read **only** in `src/config.ts`. |
  | D11 | Fixture docs location | `packages/demo/fixtures/README.md` (≤ 80 lines). Single source of truth for PRPs C–E fixture authors. |
  | D12 | Tenant scoping | Multi-tenant-capable: `advertiserId` lives on `bids[i].request`, not scenario root (feature line 182). v1 single-tenant fixtures, format does not bake that in. |
  | D13 | Barrel exports | `index.ts` exports `./types.js` + `./config.js` only. PRP-C / PRP-E add `runScenario` / `runAllScenarios` / `assertHitRate`. |
  | D14 | `seeds` shape | `{ profiles: string[]; policies: string[] }` — fixture-ID strings. PRP-B's seeder resolves IDs to filenames. |

  ## All Needed Context

  ```yaml
  - file: features/clusterD/demo-bidstream-seeding.md
    section: "file paths (56-67); recording format (119-146); guardrails + gotchas (180-198)"
    why: Source spec.
  - file: PRPs/clusterD/demo-bidstream-seeding/DEMO-BIDSTREAM-SEEDING-TODO.md
    section: "PRP-A row (14-25)"
    why: Tracker — scope boundary between PRP-A and PRPs B–E.
  - file: PRPs/clusterB/profiler-real-loop/profiler-contracts.md
    why: Structural precedent — mirror TDD/decisions/contracts/tasks shape.
  - file: packages/shared/src/schemas/bid.ts
    why: BidVerificationRequestSchema (3) — bid round-trip in loadScenario (D3).
  - file: packages/shared/src/schemas/verdict.ts
    why: VerificationVerdictSchema (11) + ReasonSchema.kind (5) — D4 + D9.
  - file: packages/shared/src/schemas/primitives.ts
    why: DecisionSchema (3) — nested inside VerificationVerdictSchema.partial().
  - file: packages/shared/package.json
    why: package.json shape to mirror for packages/demo/package.json.
  - file: packages/store/package.json
    why: Sibling workspace pkg with @scout/shared dep — mirror dep convention.
  - file: packages/shared/tsconfig.json
    why: tsconfig pattern — extends ../../tsconfig.base.json + include ["src/**/*"].
  ```

  ## Files to create / modify

  **Create** (each `.ts` + colocated `.test.ts` where applicable):

  - `packages/demo/package.json` — `@scout/demo`, mirrors `@scout/store`'s shape.
  - `packages/demo/tsconfig.json` — extends `../../tsconfig.base.json`, includes `src/**/*`.
  - `packages/demo/vitest.config.ts` — minimal (defaults like `@scout/shared`).
  - `packages/demo/src/index.ts` — barrel: `export * from "./types.js"; export * from "./config.js";`
  - `packages/demo/src/types.ts` — `ScenarioSchema`, `RecordedBidSchema`, `ExpectationSchema`, `SeedsSchema`, `loadScenario`.
  - `packages/demo/src/config.ts` — `getDemoGateUrl()`.
  - `packages/demo/src/__tests__/types.test.ts` — schema + `loadScenario` round-trip + edges.
  - `packages/demo/src/__tests__/config.test.ts` — default + env override + invalid-URL.
  - `packages/demo/fixtures/README.md` — recording-format spec, ≤ 80 lines.

  **Modify**: none. (Root `pnpm-workspace.yaml` already globs `packages/*`; no edit needed.)

  ## Target contracts — schemas

  ```ts
  // packages/demo/src/types.ts
  import { z } from "zod";
  import { BidVerificationRequestSchema, VerificationVerdictSchema } from "@scout/shared";

  /** Fixture-ID refs; PRP-B seeder resolves to filenames. D14. */
  export const SeedsSchema = z.object({
    profiles: z.array(z.string().min(1)),
    policies: z.array(z.string().min(1)),
  }).strict();
  export type Seeds = z.infer<typeof SeedsSchema>;

  /** Mirror of ReasonSchema.kind (packages/shared/src/schemas/verdict.ts:5). D9. */
  export const ReasonKindSchema = z.enum([
    "profile_signal", "policy_rule", "arbiter_disagreement", "fail_closed",
  ]);
  export type ReasonKind = z.infer<typeof ReasonKindSchema>;

  /** One recorded bid; `request` deep-parsed by loadScenario per D3. */
  export const RecordedBidSchema = z.object({
    delayMs: z.number().int().nonnegative(),  // D5
    request: z.unknown(),                     // deep-parsed in loadScenario
  }).strict();
  export type RecordedBid = z.infer<typeof RecordedBidSchema>;

  /** Per-bid expectation; partial assertion (PRP-B runs the runtime check). */
  export const ExpectationSchema = z.object({
    decision: z.enum(["ALLOW", "DENY", "HUMAN_REVIEW"]).optional(),
    reasonKinds: z.array(ReasonKindSchema).optional(),    // D9
    latencyMsMax: z.number().int().positive(),            // D7
    lobstertrapTraceIdNullable: z.boolean(),              // D8
  }).strict();
  export type Expectation = z.infer<typeof ExpectationSchema>;

  /** Top-level scenario. formatVersion frozen at "1.0" per D2. */
  export const ScenarioSchema = z.object({
    formatVersion: z.literal("1.0"),                      // D2
    name: z.string().min(1),
    description: z.string(),
    seeds: SeedsSchema,
    bids: z.array(RecordedBidSchema).min(1),
    expectations: z.array(ExpectationSchema),
  }).strict().refine((s) => s.bids.length === s.expectations.length, {  // D6
    message: "expectations.length must equal bids.length (one-to-one)",
    path: ["expectations"],
  });
  export type Scenario = z.infer<typeof ScenarioSchema>;

  /** Deep-parse: scenario shell + each bid.request + each expectation's
   * verdict-mapped fields (partial). Throws ZodError with the failing path. */
  export function loadScenario(json: unknown): Scenario {
    const scenario = ScenarioSchema.parse(json);
    scenario.bids.forEach((bid) => {
      BidVerificationRequestSchema.parse(bid.request);
    });
    const verdictPartial = VerificationVerdictSchema.partial();
    scenario.expectations.forEach((exp) => {
      const subset: Record<string, unknown> = {};
      if (exp.decision !== undefined) subset.decision = exp.decision;
      verdictPartial.parse(subset);
    });
    return scenario;
  }
  ```

  ## Target contracts — barrel + config

  ```ts
  // packages/demo/src/index.ts
  export * from "./types.js";
  export * from "./config.js";
  ```

  ```ts
  // packages/demo/src/config.ts
  import { z } from "zod";
  const UrlSchema = z.string().url();
  /** Sole reader of process.env in @scout/demo (feature 185). D10. */
  export function getDemoGateUrl(): string {
    return UrlSchema.parse(process.env.DEMO_GATE_URL ?? "http://localhost:3000");
  }
  ```

  ## Fixture README target content

  `packages/demo/fixtures/README.md` (≤ 80 lines). Sections:

  1. **Title + one-line intent**: "Recording format v1.0 for `@scout/demo`.
     Frozen contract: the replayer refuses any `formatVersion` it doesn't
     understand."
  2. **`## Shape`**: the full example JSON from feature file lines 123–139
     (one `01-clean-allow`-flavored bid, one `decision: "ALLOW"` expectation,
     with `formatVersion: "1.0"` added at the top per D2).
  3. **`## Rules`** (bullets):
     - `formatVersion: "1.0"` REQUIRED. Other values rejected at load.
     - `bids.length === expectations.length`. One-to-one (D6).
     - `delayMs` is from scenario start, not from previous bid (D5).
     - **No secrets.** No API keys, bearer tokens, or signed payloads
       (feature line 181).
     - `advertiserId` lives on `bids[].request` — multi-tenant capable (D12).

  ## Task order (TDD; commit-sized)

  ### Task 1 — Red→Green: package skeleton + empty barrel

  Red: `src/__tests__/barrel.test.ts` imports `loadScenario` from
  `@scout/demo`. Expected red: `ERR_MODULE_NOT_FOUND`. Green: create
  `package.json` (mirror `@scout/store`), `tsconfig.json`,
  `vitest.config.ts`, `src/index.ts` + `src/types.ts` (both `export
  {};`). `pnpm install` at root wires the workspace. Red shifts to
  `loadScenario not exported` — green deferred to Task 2.

  ### Task 2 — Red→Green: `ScenarioSchema` happy-path + `loadScenario`

  Red: `types.test.ts` happy-path with a minimal valid fixture built
  in-test (no JSON file — fixture authoring is PRPs C–E):

  ```ts
  const validFixture = {
    formatVersion: "1.0", name: "test", description: "",
    seeds: { profiles: [], policies: [] },
    bids: [{ delayMs: 0, request: { advertiserId: "a", policyId: "p",
      pageUrl: "https://example.com/", creativeRef: "c", geo: "US",
      ts: "2026-05-17T00:00:00Z" } }],
    expectations: [{ latencyMsMax: 300, lobstertrapTraceIdNullable: true }],
  };
  expect(loadScenario(validFixture).name).toBe("test");
  ```

  Green: implement `ScenarioSchema` + `loadScenario` per § Target
  contracts. Append to barrel.

  ### Task 3 — Red→Green: edge matrix

  Each subtest red-first:

  - **`formatVersion`**: `"0.9"` / absent rejected; `"1.0"` accepted.
  - **`delayMs`**: `-1` / `1.5` / non-number rejected; `0` accepted.
  - **`latencyMsMax`**: `0` / `-1` / non-integer rejected; `1` accepted.
  - **`lobstertrapTraceIdNullable`**: `true`/`false` accepted; absent / `"yes"` rejected.
  - **`reasonKinds`**: `["profile_signal"]` accepted; `["bogus"]` rejected.
  - **`bids.length !== expectations.length`**: refine fires; zod-path `expectations`.
  - **`.strict()` on `Scenario`**: unknown top-level key rejected.

  ### Task 4 — Red→Green: `loadScenario` deep-parse

  - **Malformed bid**: `bids[0].request` missing `creativeRef` → throws;
    pin `e.issues[0].path` includes `creativeRef`.
  - **Malformed expectation**: `decision: "MAYBE"` → throws.
  - **`loadScenario(null)` / `({})` / `("not-an-object")`**: each throws.
  - **Happy round-trip**: `bids[0].request.advertiserId` survives parse
    (proves no mutation).

  ### Task 5 — Red→Green: `config.ts` + tests

  - **Default**: `delete process.env.DEMO_GATE_URL` → `"http://localhost:3000"`.
  - **Override**: `"https://gate.example.com"` returned verbatim.
  - **Invalid**: `"not-a-url"` throws `ZodError`.
  - **Restore env** in `afterEach`.

  ### Task 6 — `fixtures/README.md`

  Write per § Fixture README target content. Manual review: every
  shape field appears so PRPs C–E authors don't open the schema file.

  ### Task 7 — Validation gates (all must pass)

  ```bash
  pnpm install                                    # wires @scout/demo
  pnpm --filter @scout/demo test                  # all green
  pnpm -r exec tsc --noEmit                       # 0 errors
  pnpm -r exec eslint . --fix                     # clean
  pnpm -r build                                   # clean
  pnpm audit                                      # no new advisories (zod only)
  grep -R "API_KEY\|secret\|bearer" packages/demo/  # 0 hits (security)
  grep -R "process.env" packages/demo/src/        # exactly 1 hit (config.ts)
  ```

  ## Security guardrails

  - **No secrets in fixtures**: enforced by `grep` gate (Task 7). The
    fixture format has no auth field; `BidVerificationRequest`
    (`packages/shared/src/schemas/bid.ts:3`) has no auth field.
  - **No `process.env.*` outside `config.ts`**: enforced by `grep` gate
    (Task 7, exactly one hit in `src/config.ts`).
  - **Multi-tenant capable**: `advertiserId` lives on `bids[].request`,
    not scenario root (feature line 182; D12). PRP-B's replayer can
    assert uniformity at runtime without a format change.
  - **`.strict()` on every schema object**: unknown keys rejected — a
    fixture typo fails CI, not the demo.
  - **`formatVersion` literal**: future bumps require explicit
    `types.ts` change; silent drift impossible.

  ## Out of scope — file as follow-ups

  - **PRP-B** — `replayer.ts` (undici keep-alive), `seeder.ts` (wraps
    `@scout/store`), `asserts.ts`, `inProcessGate.ts`. Adds `undici` +
    `@scout/store` deps.
  - **PRP-C** — `runScenario` + `runAllScenarios`, `scripts/run-demo.ts`,
    `scripts/clear-state.ts`, scenarios 1+2 + page-profile seeds.
  - **PRP-D** — scenarios 3+4, `llmMock.ts`, `--llm=real|mock` flag,
    cross-package `packages/policy/fixtures/politics-borderline.json`.
  - **PRP-E** — scenario 5 two-phase, scenario 6 Zipfian, `waitForProfile.ts`,
    `assertHitRate.ts`, `pnpm demo:*` scripts.
  - **Fixture-authoring UI** — feature line 201.
  - **Multi-tenant cross-talk scenario** — feature line 203; format
    supports it (D12), v1 ships single-tenant.
  - **Live-DPI-catch scenario** — feature line 205.

  ## Anti-Patterns

  - Don't widen `formatVersion` from `z.literal("1.0")` to `z.string()`.
    The literal IS the refusal property (D2).
  - Don't add `process.env.*` outside `config.ts` (Task 7 grep catches).
  - Don't pre-export `runScenario` / `runAllScenarios` / `assertHitRate`.
    PRPs C+E own those; exporting an unimplemented symbol breaks link.
  - Don't import `undici` here. PRP-B owns the HTTP body + dep.
  - Don't author scenario JSON fixtures here. PRPs C–E each own one.
  - Don't drop `.strict()` from any schema — silent unknown-key
    acceptance is how fixtures drift between PRPs.
  - Don't mutate `loadScenario`'s input. Tests pin input identity.
  - Don't add runtime dep on `@scout/store` or `@scout/gate`. This PRP
    is contracts-only; PRP-B adds `@scout/store`.

  ## Confidence: 9 / 10

  Pure-contract PRP in a greenfield package mirroring well-established
  conventions (`@scout/shared` + `@scout/store` package.json shape;
  `profiler-contracts.md` PRP shape; zod style in
  `packages/shared/src/schemas/*`). One residual risk: over-specifying
  the format before PRP-B reveals what the replayer needs — mitigated by
  (a) `formatVersion: "1.0"` versioning (D2) so a v1.1 bump is cheap,
  (b) `.strict()` so additions are explicit, (c) `RecordedBidSchema.request:
  z.unknown()` (D3) so the bid wire shape can evolve in `@scout/shared`.
