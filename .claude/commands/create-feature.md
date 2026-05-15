# Create Feature File — AI Ad Verification System

## Topic / one-line brief: $ARGUMENTS

Produce a new feature file at `features/{kebab-slug}.md` that the `/generate-prp` command can consume directly. Feature files are the **input** to PRP generation: they describe *what to build* with enough concrete grounding (real file paths, real interfaces, real open questions) that PRP-generation can focus on *how* without re-discovering the problem.

The canonical reference is `features/wire-chatbox-to-seller-agent-server.md`. Match its shape and density — every section pulls its weight, every example is anchored to a real path (or explicitly marked greenfield), every open question is named so it cannot be silently defaulted.

---

## Project Context — Read Before Drafting

These are authoritative; the feature file must not contradict them.

1. `CLAUDE.md` — hard constraints (sub-second SLA, pre-bid execution, plug-and-play modules, sponsor-tech load-bearing for prizes), code conventions (TS strict, NodeNext, files ≤ ~300 lines, 1 happy / 1 edge / 1 failure tests, no secrets in client code).
2. `HACKATHON-CONTEXT.md` — tracks, sponsor tech (Veea Lobster Trap, Gemini), prizes, judging criteria, dates.
3. `features/architecture.md` — the locked north star, hot-path / warm-path split, module boundaries, open questions catalogue. Reference it by section when the new feature touches a seam it already names.
4. `FEATURE-TODO.md` — the PRP backlog. If the new feature corresponds to a row there, **link to that row by name**. If it doesn't fit any existing cluster, propose appending a row (don't reshape existing rows).
5. `PLANNING.md` — if present, locked stack details. If absent, the stack is unfixed — surface architectural choices as open questions rather than baking in defaults.

---

## Process

1. **Clarify the topic.** `$ARGUMENTS` is usually a short brief. Before writing, ask **at most one** round of clarifying questions only if the topic is ambiguous on:
   - **Path placement** — hot path (≤1s, gates a bid) vs. warm path (async, agent loops allowed) vs. side-channel (dashboard / audit / authoring tool).
   - **Module boundary** — which seam in `features/architecture.md § Module boundaries` does this feature sit on (or does it introduce a new one)?
   - **Sponsor-tech relevance** — is this a Lobster Trap surface, a Gemini surface, both, or neither? "Neither" is allowed but must be explicit.

   If the brief already answers these, skip the questions and proceed.

2. **Ground the feature in the codebase.** Search for:
   - Files the implementation will touch or mirror — every `EXAMPLES` bullet must cite `path:line` (or note "greenfield — no precedent yet").
   - Existing typed contracts in `@scout/shared` (the four cross-cutting shapes: `BidVerificationRequest`, `PageProfile`, `Policy`, `VerificationVerdict`). New cross-package data needs a contract here, not an ad-hoc shape.
   - Tests near similar features for the validation style nearby.

3. **Resolve the slug.** Convert the topic into a kebab-case filename. Examples:
   - "wire the chatbox to the seller agent" → `wire-chatbox-to-seller-agent-server.md`
   - "policy match evaluation" → `policy-match-evaluation.md`
   - If a `FEATURE-TODO.md` row already names the file, **use that exact filename verbatim** — don't rename.

4. **Refuse to overwrite.** If `features/{slug}.md` already exists, stop and tell the user. Offer either a new slug or an explicit confirmation to overwrite.

5. **Draft the file** using the structure below.

6. **Cross-link.** If `FEATURE-TODO.md` has a matching unticked row, leave it unchanged but mention the row name in the feature file's `PRIORITY` section so the link is bidirectional. Do not tick the row — that happens when the **PRP** lands, not the feature file.

---

## Feature file structure

Open with a one-line persona that names the seniority and domains the implementer will need (e.g., "You are a senior backend engineer with deep experience in Node service design, queue consumers, and Gemini function-calling."). Keep it specific to the feature — not boilerplate.

Then the five required sections, in this order. Do not rename them.

### `## PRIORITY:`

Lead with **P0 / P1 / P2 / P3** and one sentence on what's blocked until this lands. If the feature corresponds to a `FEATURE-TODO.md` row, name it. Call out hot-path latency stakes explicitly — a P0 on the hot path has different urgency than a P0 on a dashboard.

### `## FEATURE:`

Concrete end state, written so a reader can tell when it's done. Include:

- The user-visible or system-visible behavior that exists after this lands.
- The file paths that get created or changed (cite them).
- The seams the feature sits on — name the modules from `features/architecture.md § Module boundaries`.
- If the feature is on the hot path, state its **latency budget contribution** in milliseconds (e.g., "≤ 50ms p95 inside the gate handler").
- The tests that must ship with it (default: 1 happy / 1 edge / 1 failure; brand-safety verdict logic needs the exhaustive matrix from `CLAUDE.md`).

### `## EXAMPLES:`

Every bullet cites `path/to/file.ts:LINE` (or `path/to/file.ts` if the whole file is the reference) with a one-sentence why. If there is no precedent in the repo for this feature, say so explicitly: *"Greenfield — no in-repo precedent. External reference: <url or repo>"*. Do not invent file paths.

### `## DOCUMENTATION:`

External URLs (deep-link to sections, not landing pages) for any SDK, spec, or external system the implementer will need. Pin Gemini model IDs and Lobster Trap policy syntax to specific docs — sponsor SDKs change, and "Gemini" alone is too vague to act on.

### `## OTHER CONSIDERATIONS:`

This is where most feature files earn their keep. Include:

- **Open questions** the implementer must decide before writing code. Phrase each as a binary or short-list choice with a recommended default, not as a vague "tbd". The `wire-chatbox-to-seller-agent-server.md` "(A) Reuse… (B) Stand up…" pattern is the canonical shape.
- **Security guardrails** for the feature — no secrets in client code, server-side-only keys, schema validation at boundaries, Lobster Trap seam preserved for any agent→LLM call, fail-closed default on brand-safety verdicts.
- **Gotchas** specific to this surface — Gemini latency variance, function-calling schema quirks, prompt-injection vectors on ad-content pages, Lobster Trap policy mis-classifications, cache invalidation traps.
- **Out of scope** — what is explicitly *not* in this feature, filed as follow-ups. Prevents scope creep during implementation.
- **Test order** when one test pins a contract others depend on.

---

## Constraint checks before saving

Refuse to save the file if any of these is violated — name the violation and propose a fix instead:

- The feature lives on the hot path **and** introduces a synchronous multi-LLM-call chain (breaks sub-second SLA).
- The feature gates the bid **post-impression** (breaks pre-bid).
- The feature hard-codes a brand-safety rule set, single-tenant assumption, or in-process state where a queue/store is the production shape (breaks plug-and-play).
- The feature routes an agent→LLM call **bypassing Lobster Trap** without an explicit "this is the agreed exception, here is why" justification in `OTHER CONSIDERATIONS`.
- The feature puts an API key, model credential, or policy decision payload in client/UI code (breaks the no-secrets-in-client rule).
- Any cited file path does not actually exist (use `Read` or `find` to verify before committing the bullet).

---

## Output

Save as: `features/{kebab-slug}.md`

After saving, print a three-line summary:

1. The path of the file written.
2. The single most important open question the implementer must answer first.
3. The next command: `/generate-prp features/{kebab-slug}.md`

## Quality checklist

- [ ] Filename is kebab-case and matches any `FEATURE-TODO.md` row verbatim (or proposes a new row)
- [ ] One-line persona is specific to the feature, not boilerplate
- [ ] `PRIORITY` names the priority level and what's blocked
- [ ] `FEATURE` states a verifiable end state, with cited file paths and (if hot-path) a latency budget
- [ ] Every `EXAMPLES` bullet cites a real `path:line` or is explicitly marked greenfield
- [ ] `DOCUMENTATION` deep-links to sections, pins Gemini model IDs, references Lobster Trap policy syntax where relevant
- [ ] `OTHER CONSIDERATIONS` lists open questions as concrete choices (A/B), not vague "tbd"s
- [ ] Hot-path features state their latency budget contribution
- [ ] Sponsor-tech relevance (Lobster Trap, Gemini) called out explicitly — including "neither" when true
- [ ] No constraint violation (see *Constraint checks*) — or the violation is named with a proposed fix
- [ ] File does not already exist (or overwrite explicitly confirmed)
- [ ] Cross-link to `FEATURE-TODO.md` row left unticked (PRP landing ticks the row, not the feature file)

Remember: the feature file is the **brief**, not the design doc. `/generate-prp` consumes it to produce the PRP, which produces the implementation. Compress the *what* and the *why* into this file so the PRP and the implementer can focus on the *how*.
