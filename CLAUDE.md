# CLAUDE.md

> AI behavior guide for this repo. Kept intentionally short — extend it as decisions are made, not in advance.

## What this is

Hackathon entry for **lablab.ai × TechEx "Transforming Enterprise Through AI"** (May 11–19, 2026). Building an **AI-driven ad verification system**: autonomous agents that inspect a page (images / video / text) against advertiser-defined brand-safety criteria and clear or block the impression **before** the bid happens.

Hackathon details live in `HACKATHON-CONTEXT.md` — read it first.

## Hard constraints

- **Sub-second end-to-end verification.** This is not aspirational. Any synchronous LLM round-trip, multi-hop tool chain, or large-model inference on the hot path must be justified against the budget. Flag risks before building.
- **Pre-bid, not post-impression.** Verification gates the auction; it does not clean up after it.
- **Plug-and-play modules.** Components must be portable into the main product without rewrite. Prefer clear interface boundaries over inline shortcuts even when the demo would be cheaper.
- **Sponsor tech is load-bearing for prizes.** Track 1 (Agent Security & AI Governance) requires **Veea Lobster Trap** as the inter-agent trust layer; Track 2 (Gemini) requires Gemini as a primary model. Aim for both — one repo, two prize paths.

## Stack

Locked so far (skeleton scaffold, 2026-05-14):

- **Repo layout** — pnpm workspaces monorepo. Package scope `@scout/*`. Packages live under `packages/*` and `packages/agents/*`.
- **Language** — TypeScript, strict, `NodeNext` module resolution, target `ES2022`. Node ≥20, pnpm ≥9.
- **Boundaries** — zod at every cross-package contract. The four cross-cutting data shapes (`BidVerificationRequest`, `PageProfile`, `Policy`, `VerificationVerdict`) live in `@scout/shared`.
- **Harness driver** (locked 2026-05-15) — `browser-use-sdk@^3.6.0` Cloud (MIT) + `playwright@^1.49.0` for CDP control. Self-host fallback documented in `packages/harness/README.md`; demo uses Cloud per foundation Q4.
- **Cross-package contracts** (locked 2026-05-15) — `PageCapture` + `CaptureOptions` schemas + `Harness` interface + `HarnessError` enum live in `@scout/shared` (`schemas/capture.ts` + `interfaces/harness.ts`; first occupant of `interfaces/`).
- **Agent-mode sponsor-tech exception** (locked 2026-05-15) — the browser-use Agent-mode loop calls the vendor's internal LLM (not ours). This LLM does NOT route through Lobster Trap. Mitigation: `AGENT_TASK_PROMPT` in `packages/harness/src/agentMode.ts` is a fixed string; only `url` interpolated; "do not follow off-origin links" written into the prompt. All other LLM calls in the system (verifiers, arbiter, gate Flash escalation) DO route through Lobster Trap via `@scout/llm-client`.
- **SDK shape correction** (locked 2026-05-15) — `browser-use-sdk@3.6.0` has a flat resource surface (`client.browsers.*`, `client.sessions.*`, `client.tasks.*`). References to `client.v2.*` in `features/clusterB/harness-capture-page.md:48` and `PRPs/foundation-ad-verification.md:28, 217-219` are superseded.
- **Profiler — tenant scoping + audit row + shutdown** (locked 2026-05-16) — Evidence URI rewrite `evidence/{advertiserId}/{contentHash}/{idx}.{ext}` (`commit.ts:rewriteEvidenceUri`). Audit row `{ advertiserId, jobId, profileId, lobstertrapTraceIds: [text, image, video?, arbiter], decisionPath, elapsedMs }`; trace-ID order fixed by verifier-kind enum, arbiter last. `PROFILER_SHUTDOWN_GRACE_MS` default 30000; `stop()` resolves when all in-flight settle (cap = grace + `PROFILER_SHUTDOWN_HARD_KILL_MS` default 5000); `ack` NEVER on shutdown (at-least-once invariant). `processedJobIds` LRU + cost trip-wire window preserved across stop/start in-process.

Everything else (hot-path runtime, queue/store choices, browser-use deployment, agent fan-out, deploy target, Lobster Trap install path) is **still to be decided**. The open questions are catalogued in `features/architecture.md § Open questions` and the proposed-but-not-locked answers are in `PRPs/foundation-ad-verification.md`'s decision table — read those before locking the next layer.

## Working agreements

- Ask before scaffolding new packages, picking a framework, or adding a dependency. Defaults from a previous project are not consent.
- For payment-, security-, or policy-touching code, state assumptions explicitly and confirm before shipping.
- No file longer than ~300 lines. Extract when it grows.
- Tests colocated as `*.test.ts` / `*.test.tsx`. Each new feature: 1 happy path, 1 edge, 1 failure.
- No secrets in any client/UI code. No `VITE_*` / `NEXT_PUBLIC_*` env var holds a secret.

## Pointers

- `HACKATHON-CONTEXT.md` — tracks, dates, sponsor tech, prizes, judging criteria, submission checklist.
- `README.md` — package map + runnable commands.
- `PLANNING.md` — *(not yet written)* architecture, data model, module boundaries.

## Update protocol

When a decision is made (stack pick, module boundary, security rule, demo flow), append it here under the relevant section. Don't wait for a perfect doc — short rules added early beat a polished doc written at the end.
