# FEATURE-TODO.md

> Backlog of PRPs to generate before the hackathon submission (May 19, 2026).
> **One PRP per session, one session per row.** Foundation PRP
> (`PRPs/foundation-ad-verification.md`) scaffolds every typed contract in
> `@scout/shared`; every row below builds against those seams and can be worked
> on in parallel.

## How to use this file

- Each row is **one feature** scoped to **one PRP-generation session**.
- "Independent of" lists peer rows that do **not** block this one — pick any
  combination across different clusters and two developers can run in parallel
  without merge collisions on hot files.
- Coupling between features is only the zod schemas in `@scout/shared`. If a
  feature would need another feature's runtime code, it consumes a stub instead
  (foundation ships valid-shape stubs for every module).
- Tick `[x]` when the **feature file is drafted** at `features/<row>.md` — so
  this list also tracks which feature files we've created. PRP commits live
  under `PRPs/`; implementation status lives in PRs/branches.

## Status legend

- `[ ]` Feature file not yet drafted
- `[~]` Feature file being drafted in an active session
- `[x]` Feature file committed under `features/`

---

## Engineering PRPs

### Cluster A — Hot path (one developer can own end-to-end)

- [x] **`gate-verdict-logic.md`** — replace the stub `POST /verify` handler with
      the real pipeline: profile lookup → policy match → optional Gemini Flash
      escalation → fail-closed verdict. Includes the **100-req synthetic
      benchmark** required by foundation Q2 (Node + Fastify vs. Bun + Hono).
      → `features/clusterA/gate-verdict-logic.md`
      *Independent of:* harness, profiler, dashboard, verifier prompts.
      *Reads:* `ProfileStore`, `PolicyStore`, `LlmClient`.
- [x] **`policy-match-evaluation.md`** — implement `policy.match(profile,
      policy) → PolicyMatchResult`. Pure function, versioned, deterministic.
      Includes example advertiser policy fixtures and rule-evaluation unit
      tests.
      → `features/clusterA/policy-match-evaluation.md`
      *Independent of:* every other row (no LLM, no I/O).

### Cluster B — Warm path (a second developer can own end-to-end)

- [x] **`harness-capture-page.md`** — real `capturePage(url, opts) →
      PageCapture` body via `browser-use-sdk/v2` Browser mode. Resolves the
      open license question on the self-hosted harness, picks Cloud vs.
      self-host for the demo, and documents the agent-mode escape hatch.
      → `features/clusterB/harness-capture-page.md`
      *Independent of:* every verifier (output is a typed `PageCapture`).
- [x] **`profiler-real-loop.md`** — queue consumer, parallel verifier fan-out,
      arbiter, profile commit, TTL handling, and the **Q6 cost trip-wire**
      (drop video → collapse text+image).
      → `features/clusterB/profiler-real-loop.md`
      *Independent of:* the four agent prompts (each is called through the
      `Verifier` interface — stubs are fine until the prompt PRPs land).

### Cluster C — Verifier agents (four developers could run in parallel; one prompt per PRP)

- [ ] **`agent-text-verifier-prompt.md`** — Gemini Pro prompt + schema-bound
      output for DOM-text classification against the advertiser taxonomy.
- [ ] **`agent-image-verifier-prompt.md`** — Gemini Pro vision prompt over
      screenshot batches; same taxonomy, visual modality.
- [ ] **`agent-video-verifier-prompt.md`** — Gemini Pro vision over sampled
      frames + poster; skip path when no video is on the page.
- [x] **`agent-arbiter-scoring.md`** — disagreement detection, confidence
      blending, `HUMAN_REVIEW` escalation threshold, evidence assembly.
      → `features/clusterC/agent-arbiter-scoring.md`
      *All four:* independent of each other (each is a pure function from a
      typed `PageCapture` slice to `AgentVerdict`/`ArbiterDecision`).

### Cluster D — Surface area & demo

- [ ] **`dashboard-verdict-views.md`** — real views over `AuditStore` next to
      the Lobster Trap iframe: verdict timeline, reasons drill-down,
      declared-vs-detected intent diff for the Veea-Award demo moment.
      *Independent of:* everything else (read-only over `AuditStore`).
- [ ] **`demo-bidstream-seeding.md`** — recorded bidstream replayer + a
      pre-seeded set of pages (a clean ALLOW, a clean DENY, an ambiguous
      Flash-escalation case, a `HUMAN_REVIEW` arbiter disagreement, a cache
      miss → DENY-then-warm scenario). This **is** the on-stage demo.
      *Independent of:* prompt content (replayer drives the gate, not the
      agents directly).
- [ ] **`lobstertrap-policy-authoring.md`** — replace the starter
      `policies/lobstertrap.yaml` with real `ALLOW / DENY / LOG /
      HUMAN_REVIEW / QUARANTINE / RATE_LIMIT` rules aligned to the gate's
      verdict vocabulary. Includes the adversarial test against
      `./lobstertrap test`. *Independent of:* every other engineering row.

---

## Cross-cutting validation (not PRPs, but must land before demo)

- [ ] **Cache hit-rate validation** (architecture.md § Hot path). Synthetic
      mixed-popularity bid stream; confirm the modest-cache assumption holds
      before stage. Folded into `demo-bidstream-seeding.md` if simpler.
- [ ] **End-to-end Lobster Trap trace continuity** —
      `VerificationVerdict.lobstertrapTraceId` round-trips into the Veea
      audit log on every demo verdict. Folded into `gate-verdict-logic.md`.
- [ ] **Tenant isolation smoke test** — advertiser A cannot read advertiser
      B's policies/verdicts. Folded into `policy-match-evaluation.md`.

---

## Submission deliverables (non-PRP, but block May 19)

- [ ] Cover image + project title + short/long descriptions + tags
- [ ] Slide deck
- [ ] Video presentation (must show both Gemini hot+warm and the Lobster
      Trap DPI moment — both prize narratives in one cut)
- [ ] Public demo URL + hosting target chosen
- [ ] Public GitHub repo polish (README, MIT license, no secrets)
- [ ] Onsite logistics for May 18–19, San Jose McEnery Convention Center

---

## Update protocol

When a feature lands, tick it here and add a one-line pointer to `features/<cluster><file>.md`.
When a new feature surfaces, append a row in the smallest cluster it fits —
don't reshape existing rows. Keep the file under ~200 lines.
