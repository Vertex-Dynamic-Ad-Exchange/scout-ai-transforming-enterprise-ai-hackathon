# Execute BASE PRP — AI Ad Verification System

Implement a feature for the **AI-driven ad verification system** (lablab.ai × TechEx "Transforming Enterprise Through AI" hackathon entry) using the specified PRP file.

## PRP File: $ARGUMENTS

## Execution Process

1. **Load project context** (before the PRP itself)
   - Read `CLAUDE.md` (hard constraints, security rules, behavior guide — authoritative).
   - Read `HACKATHON-CONTEXT.md` if the PRP touches tracks, sponsor tech (Veea Lobster Trap, Gemini), or judging criteria.
   - Read `PLANNING.md` if present (architecture, structure).
   - Sponsor SDKs (Gemini API, Lobster Trap) move fast — verify method signatures against current vendor docs **before** writing novel calls. Don't trust unverified training-data signatures.

2. **Load PRP**
   - Read the specified PRP file end-to-end.
   - Understand all context and requirements.
   - Follow all instructions in the PRP and extend research if needed (WebFetch / WebSearch / codebase exploration).
   - Ensure the hackathon constraints the PRP calls out are still satisfied:
     - Sub-second end-to-end verification (state per-feature latency contribution if on the hot path)
     - Pre-bid execution (verification gates the auction; doesn't clean up after it)
     - Plug-and-play modules (clear interface contracts, no hackathon-only shortcuts)
     - Sponsor-tech prize path intact (Lobster Trap as inter-agent seam for Track 1; Gemini as primary model for Track 2)
   - If any PRP step conflicts with `CLAUDE.md`, `CLAUDE.md` wins — surface the conflict before proceeding.

3. **ULTRATHINK**
   - Think hard before executing. Build a comprehensive plan addressing every PRP requirement.
   - Use the **Task tool (TaskCreate / TaskUpdate)** to track work. Do not use TodoWrite.
   - Break complex work into small, single-commit-sized tasks.
   - Identify existing patterns to mirror (with file paths). Confirm the files still exist before referencing them. The repo is fresh — many features will be greenfield, so don't invent prior patterns where none exist.
   - For any policy-, security-, or verdict-affecting change: **state your assumptions explicitly and confirm before shipping** (per `CLAUDE.md`). A wrong brand-safety verdict in production is far more expensive than a clarifying question.

4. **Execute the plan**
   - Implement the code, task by task. Mark each task `in_progress` when starting and `completed` when done — do not batch status updates.
   - Respect the project rules:
     - Files ≤ ~300 lines (extract when growing).
     - Schema validation (e.g., zod) at every boundary (HTTP, sponsor SDK responses, agent tool inputs/outputs, env/config).
     - Env vars only through a typed config module. Never inline `process.env.FOO` in business logic.
     - No secrets in any client/UI code. No `VITE_*` / `NEXT_PUBLIC_*` holding secrets.
     - Sponsor API keys (Gemini, Lobster Trap) and any other credentials are server-side only and never logged.
     - Brand-safety verdicts are server-side authoritative — never trust client or agent-tool responses to gate the bid.
     - Inter-agent messages traverse the Lobster Trap seam — no direct agent→agent calls that bypass policy/inspection.
     - Agent tools are thin wrappers over server-side functions — no business logic.
     - Cap agent iterations conservatively (default 5; lower on the hot path where latency budget is tight).
     - Fail closed on brand-safety verdicts unless the PRP explicitly justifies fail-open.
   - Colocate tests as `*.test.ts` / `*.test.tsx`. Each new feature ships 1 happy path + 1 edge case + 1 failure case.
   - Mock Gemini at the SDK boundary; mock Lobster Trap with realistic non-`ALLOW` responses, not just the happy path.
   - **Never delete or overwrite existing code** unless the PRP explicitly instructs it.

5. **Validate**
   Run each gate. Fix failures and re-run until green. Adapt these to the chosen stack — placeholders assume TS/pnpm.

   ```bash
   # Type checking
   pnpm -r exec tsc --noEmit

   # Linting & formatting
   pnpm -r exec eslint . --fix && pnpm -r exec prettier --write .

   # Unit tests (Vitest; RTL for any UI)
   pnpm -r test

   # Build verification
   pnpm -r build
   ```

   For hot-path features, also run the **latency gate** defined by the PRP (microbenchmark or integration test that fails if p95 exceeds budget).

   Before any submission build, also run:

   ```bash
   pnpm audit
   ```

   Do not mark the PRP complete until all gates pass.

6. **Complete**
   - Ensure every PRP checklist item is done.
   - Run the full validation suite one more time.
   - Re-read the PRP to verify nothing was skipped.
   - For demo-affecting changes, sanity-check:
     - Hot-path latency still under the sub-second budget (no new synchronous LLM round-trips, multi-hop chains, or large-model inferences inserted unintentionally).
     - Lobster Trap seam still in place between every agent pair.
     - No new client/UI import reaches into a server-side or secret-bearing module.
     - Plug-and-play boundary preserved — no inline shortcut that would force a rewrite to productionize.
   - Report completion status, including any **Discovered During Work** follow-ups (add them as new tasks via TaskCreate, or mirror to `TASK.md` if present).

7. **Reference the PRP**
   - You can always re-open the PRP for clarification while working.

Note: If validation fails, use the error patterns in the PRP to diagnose and fix. If a failure reveals a PRP-level gap (missing assumption, stale SDK signature, wrong sponsor-tech reference), fix the PRP as well as the code — a stale PRP will mislead the next execution.
