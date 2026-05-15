# scout-ai-transforming-enterprise-ai-hackathon

Pre-bid AI ad verification — hackathon entry for **lablab.ai × TechEx "Transforming Enterprise Through AI"** (May 11–19, 2026).

One sentence: an advertiser's bid request is gated by sub-second agentic verification that the destination page (and creative) match the advertiser's brand-safety policy — before money moves.

## Read first

- **`HACKATHON-CONTEXT.md`** — tracks, dates, sponsor tech (Veea Lobster Trap, Gemini), prizes, judging criteria.
- **`CLAUDE.md`** — hard constraints (sub-second, pre-bid, plug-and-play, sponsor-tech load-bearing), working agreements, and locked stack decisions.
- **`features/architecture.md`** — the working architecture spec. Hot path / warm path split, module boundaries, data shapes, open questions.

## Repo state — skeleton only

This is a structural scaffold. Every package has empty bodies; only `@scout/shared` ships real code (zod schemas for the four cross-cutting data shapes from `features/architecture.md § Data shapes`). Feature implementations land in per-feature PRPs under `PRPs/`.

## Packages

| Package                       | Purpose                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `@scout/shared`               | Zod schemas + shared types. The contract every other package consumes.                                                       |
| `@scout/gate`                 | Hot-path HTTP service. `POST /verify` returns a `VerificationVerdict` in ≤1s. Fail-closed.                                   |
| `@scout/profiler`             | Warm-path worker. Consumes `ProfileJob`s, drives the verifier-agent fan-out, commits `PageProfile`s.                         |
| `@scout/llm-client`           | The **only** door to an LLM. All LLM traffic must route through here so Lobster Trap can inspect it.                         |
| `@scout/harness`              | `browser-use` wrapper. `capturePage(url, opts) → PageCapture`. Hides Browser-mode vs Agent-mode.                             |
| `@scout/policy`               | YAML policy loader + matcher. `match(profile, policy) → PolicyMatchResult`. Pure, versioned.                                 |
| `@scout/store`                | `ProfileStore` + `PolicyStore` + `AuditStore` behind interfaces. Demo impls swap for prod impls without touching call sites. |
| `@scout/agent-text-verifier`  | Categorizes DOM text + meta against the advertiser taxonomy.                                                                 |
| `@scout/agent-image-verifier` | Same taxonomy, screenshots.                                                                                                  |
| `@scout/agent-video-verifier` | Same taxonomy, sampled video frames.                                                                                         |
| `@scout/agent-arbiter`        | Cross-checks the three verifier verdicts; flags disagreement → `HUMAN_REVIEW`.                                               |
| `@scout/dashboard`            | Governance UI. Read-only over `AuditStore` + Lobster Trap's own audit log.                                                   |

## Development

```bash
pnpm install
pnpm typecheck
pnpm format
```

Node ≥20, pnpm ≥9. See `.nvmrc`.

## What lives where (next steps)

Each package is empty pending its own feature PRP. Suggested first slice:

1. `@scout/llm-client` — wire the OpenAI SDK at Lobster Trap, backed by Gemini's `/v1beta/openai/` compat endpoint. (Cited rationale: `features/architecture.md § Where each sponsor tech lives`.)
2. `@scout/policy` — minimal `match()` over a hand-rolled `Policy` against a hand-rolled `PageProfile`.
3. `@scout/gate` — Fastify app, `POST /verify`, profile lookup → policy match → verdict.
4. `@scout/harness` — `browser-use-sdk` Browser-mode `capturePage`.
5. Verifier agents + arbiter — one PRP each, prompts + zod-validated output.
6. `@scout/dashboard` — Vite/React, embed Lobster Trap's UI + a verdict viewer.
7. Deploy — Docker + Fly.io (5 apps in `sjc`).

Order is suggestion, not mandate; the package boundaries are designed to land independently.
