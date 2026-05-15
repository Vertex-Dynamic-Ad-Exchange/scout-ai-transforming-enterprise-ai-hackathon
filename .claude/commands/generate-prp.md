# Create PRP — AI Ad Verification System

## Feature file: $ARGUMENTS

Generate a complete PRP (Product Requirement Prompt) for a feature in the **AI-driven ad verification system** — a hackathon entry for **lablab.ai × TechEx "Transforming Enterprise Through AI"** (May 11–19, 2026). The product is pre-bid, agent-driven brand-safety verification of pages (image / video / text) against advertiser-defined criteria, with a sub-second SLA. The PRP must carry enough context that an implementing agent can deliver a one-pass, validated implementation without re-discovering project conventions.

Read the feature file first to understand what needs to be created, how any provided examples help, and any other considerations.

The implementing agent only gets the context you append to the PRP plus its training data. Assume it has access to the codebase and the same knowledge cutoff as you, so research findings must be included or referenced in the PRP. The agent has WebFetch / WebSearch capabilities, so pass URLs to documentation and examples.

---

## Project Context — Read Before Researching

These docs are authoritative for this repo. Read them **before** researching, in this order:

1. `CLAUDE.md` — AI behavior rules, hard constraints, code conventions, security rules. Authoritative — overrides anything else.
2. `HACKATHON-CONTEXT.md` — submission brief: tracks, sponsor tech (Veea Lobster Trap, Gemini), prizes, judging criteria, dates.
3. `PLANNING.md` — *(when present)* architecture, data model, module boundaries. If absent, treat the stack as unfixed and surface architectural choices in the PRP for confirmation.
4. `README.md` — runnable commands (currently a stub).

### Non-negotiable hackathon constraints (the PRP must preserve all four)

- **Sub-second end-to-end verification.** Any synchronous LLM round-trip, multi-hop tool chain, or large-model inference on the hot path must be justified against the budget. If the feature lives on the hot path, state its latency budget contribution explicitly.
- **Pre-bid, not post-impression.** Verification gates the auction; it does not clean up after it. A feature that only fires post-bid breaks this — flag it.
- **Plug-and-play modules.** Components must be portable into the main product without rewrite. Prefer clear interface boundaries (typed contracts at every seam) over inline shortcuts even when the demo would be cheaper. No hardcoded brand-safety rule sets, single-tenant assumptions, or in-process state where a queue/store is the production shape.
- **Sponsor tech is load-bearing for prizes.** Track 1 (Agent Security & AI Governance) requires **Veea Lobster Trap** as the inter-agent trust layer. Track 2 (Gemini Award) requires Gemini as a primary model — Flash for the sub-second hot path; Pro only for off-path reasoning. Aim to keep both prize paths open in the same submission.

If the feature as written would break any of these, flag it in the PRP and propose an alternative before writing the blueprint.

---

## Research Process

1. **Codebase analysis**
   - Search the repo for similar features/patterns. The repo is fresh — most features will be greenfield, so explicitly call out when a feature is the first of its kind in a given module.
   - Identify the exact files the implementation will touch or mirror — list them in the PRP with paths.
   - Note conventions as they emerge: clear module boundaries, typed contracts at seams, no secrets in client code, files ≤ ~300 lines.
   - Check for colocated `*.test.ts` / `*.test.tsx` near similar features for the validation style used nearby.

2. **Sponsor tech research** (project-specific — do this before generic web research)
   - **Veea Lobster Trap**: deep prompt inspection (DPI) proxy between agents and any OpenAI-compatible LLM. YAML policies with `ALLOW / DENY / LOG / HUMAN_REVIEW / QUARANTINE / RATE_LIMIT`; `_lobstertrap` metadata for declared-vs-detected intent. If the feature involves any inter-agent message flow, the PRP must show where Lobster Trap sits as the policy/inspection seam — don't bake direct agent→agent calls that bypass it. (Team has not yet committed to Lobster Trap as a hard dependency — flag and ask before locking it in.)
   - **Gemini (Flash / Pro) via AI Studio or API**: confirm model selection against the latency budget. Pin the exact model ID in the PRP — don't refer vaguely to "Gemini".
   - SDKs change fast — verify method signatures against current vendor docs before writing novel calls.

3. **External research** (only after the above)
   - Library docs with specific URLs (deep-link to sections, not landing pages).
   - Implementation examples (GitHub / blog posts).
   - Known gotchas: Gemini function-calling schema quirks, streaming-vs-non-streaming latency tradeoffs, Lobster Trap policy structure, prompt-injection defense patterns specific to ad-content pages, multi-agent coordination iteration caps.

4. **User clarification** (only if truly needed)
   - Specific patterns to mirror and where to find them?
   - Integration surface: which package boundary does this feature sit on, and does it run on the hot path?
   - Hot path or governance/dashboard side-channel?
   - For policy-, security-, or verdict-touching code: CLAUDE.md requires explicit assumption-stating before shipping — surface this in the PRP.

---

## PRP Generation

Use `PRPs/templates/prp_base.md` as the template if it exists. If it doesn't yet, create the PRP with the following sections:

### Critical context to include and pass to the implementing agent

- **Documentation:** URLs with specific sections (Gemini API, Lobster Trap repo/docs, any other library).
- **Code examples:** real snippets from this codebase (with paths + line ranges). If the feature is greenfield, say so and supply external reference snippets instead.
- **Gotchas:** Gemini latency variance under load, function-calling schema quirks, Lobster Trap policy mis-classifications, prompt-injection vectors specific to ad-content pages, sub-second budget breakdown.
- **Patterns:** existing module-boundary patterns in the repo to mirror.
- **Hackathon constraint check:** confirm the feature respects sub-second SLA, pre-bid execution, plug-and-play boundaries, and at least one of the two sponsor-tech prize paths.

### Security guardrails (always include in the PRP)

- No secrets in any client/UI code. No `VITE_*` / `NEXT_PUBLIC_*` env var may hold a secret.
- API keys (Gemini, any other LLM provider) and Lobster Trap credentials are server-side only, loaded via a typed config module.
- Never log, print, or echo API keys or raw policy-decision payloads that contain user content.
- Inter-agent messages must traverse the Lobster Trap (or its placeholder seam) — no direct agent→agent calls that bypass policy/inspection.
- All inbound boundaries validated with a schema validator (e.g., zod) — reject on first failure.
- Brand-safety verdicts are server-side authoritative — never trust a client or agent-tool response to gate the bid.
- A Lobster Trap `DENY` or `QUARANTINE` decision must short-circuit the bid even if a downstream agent disagrees (defense in depth).

### Implementation blueprint

- Start with pseudocode showing the approach.
- Reference real files for patterns (with paths). If none exist yet, state that explicitly.
- Include error-handling strategy: what gets retried, what gets surfaced, what gets rejected at the boundary, and what the failure-mode default is. **Fail closed on brand-safety verdicts unless the PRP explicitly justifies fail-open.**
- List tasks in the order they should be completed, each scoped small enough to land as a single commit.
- Call out any file that would exceed the ~300-line cap — extract before implementing.
- For any new module, define its public interface (the plug-and-play contract) **before** its internals.

### Validation gates (must be executable)

The stack is not yet locked (`CLAUDE.md` § Stack). Use the gates that match the chosen stack; the placeholders below assume a TS/pnpm setup — adapt when the stack is confirmed in `PLANNING.md` or `CLAUDE.md`.

```bash
# Type checking (strict mode, no `any` without a // Reason: comment)
pnpm -r exec tsc --noEmit

# Linting & formatting
pnpm -r exec eslint . --fix && pnpm -r exec prettier --write .

# Unit tests (Vitest + RTL for any UI)
pnpm -r test

# Build verification
pnpm -r build

# Security check before any demo/submission build
pnpm audit
```

For any hot-path feature, also include a **latency gate** — a microbenchmark or integration test that fails if p95 exceeds the budget allocated in the PRP.

Every new feature must ship with **1 happy path, 1 edge case, 1 failure case** test. For brand-safety verdict logic, add exhaustive unit tests covering: clear-allow, clear-deny, ambiguous (HUMAN_REVIEW), policy-version mismatch, and agent disagreement. Mock Gemini at the SDK boundary (not deep inside handlers). Mock Lobster Trap with realistic non-`ALLOW` responses, not just the happy path.

**_ CRITICAL: AFTER RESEARCHING AND EXPLORING THE CODEBASE, BEFORE WRITING THE PRP _**

**_ ULTRATHINK ABOUT THE PRP AND PLAN YOUR APPROACH, THEN START WRITING _**

---

## Output

Save as: `PRPs/{feature-name}.md`

## Quality checklist

- [ ] Project docs (`CLAUDE.md`, `HACKATHON-CONTEXT.md`, `PLANNING.md` if present) referenced by name + section
- [ ] Hackathon constraints (sub-second SLA, pre-bid, plug-and-play, sponsor-tech prize path) explicitly checked
- [ ] Security guardrails section present (no-secrets-in-client, server-side-only keys, schema validation at boundaries, Lobster Trap seam preserved)
- [ ] Sponsor SDK signatures (Gemini, Lobster Trap) verified against current docs — no invented methods, model IDs pinned
- [ ] For policy/verdict/security-touching code: assumptions stated explicitly
- [ ] Validation gates executable (type-check, lint, test, build, audit) — adapted to the chosen stack
- [ ] Latency gate included for any hot-path feature
- [ ] Task list uses the Task tool (TaskCreate/TaskUpdate) — not TodoWrite
- [ ] 1 happy / 1 edge / 1 failure test scoped per new feature surface
- [ ] References existing patterns with file paths (or explicitly notes greenfield)
- [ ] Public interface (plug-and-play contract) defined before internals for new modules
- [ ] Clear, ordered implementation path with per-task commit granularity
- [ ] Error-handling strategy documented, including fail-closed default for brand-safety verdicts
- [ ] No files projected to exceed ~300 lines (or extraction plan noted)

Score the PRP on a scale of 1–10 (confidence level to succeed in one-pass implementation using Claude Code).

Remember: the goal is one-pass implementation success through comprehensive, project-specific context — not generic web-search summaries.
