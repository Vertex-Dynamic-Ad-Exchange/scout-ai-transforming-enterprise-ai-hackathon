name: "Gate Verdict Logic — Real POST /verify Pipeline"
description: |

  Replace the foundation stub in `@scout/gate` with the real verdict pipeline:
  profile lookup → TTL check → tenant-scoped policy lookup → policy match →
  optional Gemini Flash escalation → fail-closed verdict assembly → deferred audit.
  Sets the sub-second SLA. Unlocks foundation Q2 (Node+Fastify vs Bun+Hono
  decision) via the 100-req benchmark. Owns the Veea-Award demo moment
  (lobstertrapTraceId on every ambiguous-path verdict).

  Priority: **P0 — hot-path, demo-blocking.**
  Source feature file: `features/clusterA/gate-verdict-logic.md`
  Source architecture: `features/architecture.md:24-37`
  Foundation PRP (read before implementing): `PRPs/foundation-ad-verification.md`

---

## Goal

Replace `packages/gate/src/index.ts`'s stub-DENY handler (landed by foundation task 7)
with a production-quality verdict pipeline. End state: `POST /verify` correctly
returns ALLOW, DENY, or HUMAN_REVIEW within 1000ms P99, with structured `Reason[]`
citing which profile signals and policy rules drove the decision, and a non-null
`lobstertrapTraceId` on every verdict that touched Flash.

---

## Why

- **Demo-blocking**: Without this, the stage demo shows a stub DENY for every bid.
  No Lobster Trap trace, no policy match, no Flash escalation. Nothing is exercised.
- **SLA-setter**: This PRP owns the sub-second SLA. All other features consume
  budget set here.
- **Veea Award unlock**: `lobstertrapTraceId` on ambiguous verdicts links the
  gate's audit row to Lobster Trap's own audit log — that linkage *is* the demo
  moment for Track 1.
- **Gemini Award evidence**: Flash is the visible Gemini integration on the hot path.
  The bench script produces the latency numbers the submission video needs.

---

## Hackathon Constraint Check

| Constraint | Status | Evidence |
|---|---|---|
| Sub-second (≤1000ms P99) | ✅ Owned here | Latency budget below; bench asserts P50<250ms, P95<600ms, P99<1000ms |
| Pre-bid gating | ✅ | `POST /verify` gates the auction — no impression happens on DENY |
| Plug-and-play modules | ✅ | DI pattern; no hardcoded rules; store/llm-client/policy behind interfaces |
| Veea Lobster Trap (Track 1) | ✅ | All Flash calls via `LlmClient` (which routes through Lobster Trap); `lobstertrapTraceId` round-trips into audit |
| Gemini Flash (Track 2) | ✅ | `gemini-2.5-flash` for ambiguous escalation; pinned model ID |

**No constraints broken.** This feature sits entirely on the hot path and respects all four.

---

## Pre-conditions (Do NOT start until these foundation tasks are complete)

This PRP consumes stubs and interfaces that foundation creates. Verify before coding:

```bash
# These must not return `export {};` before you start:
cat packages/store/src/index.ts      # must export ProfileStore, PolicyStore, AuditStore, ProfileQueue interfaces
cat packages/llm-client/src/index.ts # must export createLlmClient, LlmClient type, GEMINI_FLASH_MODEL
cat packages/policy/src/index.ts     # must export createPolicyMatcher, PolicyMatcher type, PolicyMatchResult type
cat packages/gate/src/index.ts       # must export createApp() with stub POST /verify route
```

If any of these are still `export {};`, complete foundation tasks 4–7 first.

---

## All Needed Context

### Documentation

```yaml
- url: https://ai.google.dev/gemini-api/docs/openai#chat-completions
  why: Gemini OpenAI-compat endpoint. Confirms baseURL format. Use model ID
    "gemini-2.5-flash" (NOT "-latest"). response_format, max_tokens, and structured
    output are supported via the compat layer (beta).

- url: https://ai.google.dev/gemini-api/docs/models#gemini-2.5-flash
  why: Flash latency characteristics (~300-800ms typical, tail risk past 1s).
    Justifies the 400ms hard timeout and ≤32 token max_tokens for the escalation
    response. Do not assume stable sub-100ms response times.

- url: https://fastify.dev/docs/latest/Reference/Lifecycle/
  why: Fastify lifecycle hook ordering. Each onRequest/preHandler adds 1-3ms.
    RESIST adding multiple hooks — collapse into one preHandler if needed. The
    bench will catch latency creep.

- url: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
  why: Fastify schema-first validation. May coexist with zod; zod is canonical
    for the contract; Fastify schema is optional overlay for serialization speed.
    Do not replace zod with Fastify schema at the route seam.

- url: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static
  why: AbortSignal.timeout(400) is how the 400ms Flash cutoff is enforced. The
    signal is passed into llmClient.chat(...rest) which threads it into
    oai.chat.completions.create({ signal }). Node 20+ supports this natively.

- url: https://github.com/veeainc/lobstertrap#bidirectional-metadata-headers
  why: The `_lobstertrap.verdict` and `_lobstertrap.request_id` fields that
    LlmClient parses and returns as `{ verdict, lobstertrapTraceId }`. Gate
    inspects `verdict` to override Flash's text response on DENY.

- url: https://github.com/veeainc/lobstertrap#configuration
  why: YAML policy actions: ALLOW / DENY / LOG / HUMAN_REVIEW / QUARANTINE /
    RATE_LIMIT. Gate's verdict vocabulary must align with these so the dashboard
    shows one audit story, not two.

- url: https://github.com/redis/ioredis#pipelining
  why: AuditStore.put uses ioredis. Do NOT pipeline ProfileStore.get with
    AuditStore.put — they're on different timing paths. Audit write is deferred.
```

### Existing Schema Files (already in `@scout/shared` — DO NOT MODIFY)

```yaml
- file: packages/shared/src/schemas/bid.ts
  lines: 1-11
  why: BidVerificationRequestSchema. Wire input. Call .parse() at the route boundary
    ONLY — never deeper in handler.ts. Fields: advertiserId, policyId, pageUrl,
    creativeRef, geo (alpha-2), ts (ISO datetime).

- file: packages/shared/src/schemas/verdict.ts
  lines: 1-19
  why: VerificationVerdictSchema + ReasonSchema. Wire output. Every code path
    must produce a value that passes VerificationVerdictSchema.parse() — add a
    parse() call as the final step in assembleVerdict() (defense-in-depth).
    ReasonSchema.kind: "profile_signal" | "policy_rule" | "arbiter_disagreement" | "fail_closed".

- file: packages/shared/src/schemas/profile.ts
  lines: 22-32
  why: PageProfileSchema. Cache value type. CRITICAL: ttl is SECONDS (int().positive()),
    NOT milliseconds. capturedAt is ISO 8601 datetime string. TTL check must be:
    Date.now() > new Date(profile.capturedAt).getTime() + profile.ttl * 1000

- file: packages/shared/src/schemas/policy.ts
  lines: 1-25
  why: PolicySchema. Carries escalation: { ambiguousAction: Decision,
    humanReviewThreshold: number (0-1) }. The humanReviewThreshold is the dial
    gate uses to classify ambiguous matches. ambiguousAction is the fallback when
    Flash is not configured ("HUMAN_REVIEW" skips Flash entirely).

- file: packages/shared/src/schemas/primitives.ts
  lines: 1-4
  why: DecisionSchema: "ALLOW" | "DENY" | "HUMAN_REVIEW". Gate emits all three.

- file: tsconfig.base.json
  why: strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes +
    verbatimModuleSyntax + NodeNext. ALL array accesses return T|undefined
    (guard before use). ALL relative imports need .js extensions. ALL type-only
    imports must use `import type`. No `any` without `// Reason:` comment.
```

### Foundation PRP References (contracts this PRP consumes)

```yaml
- file: PRPs/foundation-ad-verification.md
  lines: 115-203
  why: LlmClient.chat({messages, model, ...rest}, intent) shape. The `...rest`
    spread passes arbitrary fields including `signal` to oai.chat.completions.create.
    Returns { content, lobstertrapTraceId, verdict, usage }. Gate never imports
    openai directly — ESLint rule from foundation task 3 blocks it.

- file: PRPs/foundation-ad-verification.md
  lines: 140-144
  why: BidVerificationRequest.geo is alpha-2. VerificationVerdict.lobstertrapTraceId
    is nullable. Foundation locks these — gate relies on the locks.

- file: PRPs/foundation-ad-verification.md
  lines: 207-213
  why: GEMINI_API_KEY lives ONLY in @scout/llm-client/src/config.ts. Gate process
    inherits the env var but MUST NEVER read process.env.GEMINI_API_KEY. The
    ESLint rule from foundation task 3 also blocks `import openai` in gate/.
```

---

## Current Codebase State (all stubs)

```
packages/
  shared/src/
    schemas/bid.ts         ← REAL (BidVerificationRequestSchema)
    schemas/verdict.ts     ← REAL (VerificationVerdictSchema, ReasonSchema)
    schemas/profile.ts     ← REAL (PageProfileSchema)
    schemas/policy.ts      ← REAL (PolicySchema)
    schemas/primitives.ts  ← REAL (DecisionSchema)
    index.ts               ← REAL (barrel export)
  gate/src/
    index.ts               ← STUB (export {}; → foundation task 7 adds Fastify + stub DENY)
  store/src/
    index.ts               ← STUB (→ foundation task 4 adds interfaces + impls)
  llm-client/src/
    index.ts               ← STUB (→ foundation task 5 adds createLlmClient + LlmClient type)
  policy/src/
    index.ts               ← STUB (→ foundation task 5 adds createPolicyMatcher + PolicyMatchResult)
```

## Desired Codebase State (after this PRP)

```
packages/gate/
  src/
    index.ts               ← MODIFIED: createApp(deps) mounts real handler
    handler.ts             ← NEW (≤150 lines): request handler, pipeline orchestration
    escalate.ts            ← NEW (≤110 lines): Flash escalation, AbortSignal, Lobster Trap verdict check
    verdict.ts             ← NEW (≤80 lines): assembleVerdict, buildReasonsFromMatch, failClosedVerdict
    handler.test.ts        ← NEW (≤300 lines): exhaustive verdict matrix (11 test cases)
  scripts/
    bench-verify.ts        ← NEW (≤100 lines): 100-req synthetic benchmark
  package.json             ← MODIFIED: add fastify, vitest, @scout/store, @scout/llm-client, @scout/policy
```

---

## Interface Contracts Gate Expects from Foundation

These types MUST exist in the named packages before gate compilation succeeds.
If foundation has not yet defined them, define them as part of the gate PRP's
pre-task (Task 0 below).

### From `@scout/policy` — `PolicyMatchResult`

```typescript
// packages/policy/src/index.ts must export:
export interface PolicyMatchResult {
  decision: Decision;            // preliminary: ALLOW | DENY | HUMAN_REVIEW
  confidence: number;            // 0-1; how decisive the rule match was
  ambiguous: boolean;            // pre-computed: confidence < policy.escalation.humanReviewThreshold
  matchedRules: Array<{
    ruleId: string;              // PolicyRule.id
    kind: "category" | "entity" | "creative_tag";
    action: Decision;
    matchedValue: string;        // the profile value that triggered this rule
  }>;
}

// Foundation stub returns fixed shape; gate tests mock via DI (not vi.mock)
export interface PolicyMatcher {
  match(profile: PageProfile, policy: Policy): PolicyMatchResult;
}
export function createPolicyMatcher(): PolicyMatcher;
```

### From `@scout/store` — Store Interfaces

```typescript
// packages/store/src/index.ts must export:
export interface ProfileStore {
  get(url: string, contentHash?: string): Promise<PageProfile | null>;
  put(profile: PageProfile): Promise<void>;
}

export interface PolicyStore {
  // ALWAYS tenant-scoped: never PolicyStore.get(policyId) without advertiserId
  get(policyId: string, advertiserId: string): Promise<Policy | null>;
}

export interface AuditRow {
  id: string;                    // uuid
  requestId: string;             // BidVerificationRequest.ts (used as correlation ID)
  verdict: VerificationVerdict;
  request: BidVerificationRequest;
  createdAt: string;             // ISO datetime
}

export interface AuditStore {
  put(row: AuditRow): Promise<void>;
}

export interface ProfileJob {
  url: string;
  advertiserId: string;
  policyId: string;
  requestedAt: string;           // ISO datetime
}

export interface ProfileQueue {
  enqueue(job: ProfileJob): Promise<void>;
}

// Factory used in index.ts (real deps):
export function createStores(config?: StoreConfig): {
  profileStore: ProfileStore;
  policyStore: PolicyStore;
  auditStore: AuditStore;
  profileQueue: ProfileQueue;
};
```

### From `@scout/llm-client` — LlmClient

```typescript
// packages/llm-client/src/index.ts must export:
export const GEMINI_FLASH_MODEL = "gemini-2.5-flash"; // pinned, no -latest

export interface LobstertrapDeclaredIntent {
  declared_intent: string;
  agent_id: string;
  declared_paths?: string[];
}

export interface LlmChatArgs {
  model?: string;                // defaults to GEMINI_FLASH_MODEL
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  response_format?: { type: "json_object" };
  max_tokens?: number;
  signal?: AbortSignal;          // from AbortSignal.timeout(400) on escalation calls
}

export interface LlmChatResult {
  content: string;
  lobstertrapTraceId: string | null; // null when Lobster Trap is unreachable
  verdict: string;               // Lobster Trap's verdict: "ALLOW"|"DENY"|"LOG"|etc.
  usage: { prompt_tokens: number; completion_tokens: number } | null;
}

export interface LlmClient {
  chat(args: LlmChatArgs, intent: LobstertrapDeclaredIntent): Promise<LlmChatResult>;
  healthcheck(): Promise<{ ok: true; lobstertrapVersion: string } | { ok: false; reason: string }>;
}

export function createLlmClient(): LlmClient;
```

---

## Known Gotchas

```typescript
// CRITICAL: ttl is SECONDS, not milliseconds
// WRONG:  Date.now() > new Date(profile.capturedAt).getTime() + profile.ttl
// CORRECT:
function isTtlExpired(profile: PageProfile): boolean {
  return Date.now() > new Date(profile.capturedAt).getTime() + profile.ttl * 1000;
}

// CRITICAL: AbortSignal.timeout(400) may not abort the underlying socket.
// The OpenAI SDK respects signal, but Lobster Trap is an extra hop.
// Use timeout(400) as the minimum — note in tests that socket-level abort
// is not guaranteed beyond the SDK's signal propagation.
// Feature gotcha says: oai.chat.completions.create({ signal: AbortSignal.any([handlerAbort, AbortSignal.timeout(400)]) })
// Since gate passes signal in LlmChatArgs, not directly to oai, the combined
// signal must be assembled before calling llmClient.chat.

// CRITICAL: Lobster Trap can DENY independent of Gemini's text response.
// DPI may detect prompt-injection in the Flash prompt. Gate MUST check
// result.verdict before trusting result.content. A verdict of "DENY" from
// Lobster Trap means fail-closed regardless of model output.

// CRITICAL: noUncheckedIndexedAccess is true.
// matchResult.matchedRules[0].ruleId → TypeScript error (T|undefined)
// Must guard: const first = matchResult.matchedRules[0]; if (first) { ... }
// Use .map() / .flatMap() instead of index access where possible.

// CRITICAL: verbatimModuleSyntax is true.
// Type-only imports MUST use `import type`:
//   import type { PageProfile, Policy } from "@scout/shared";
//   import { PageProfileSchema } from "@scout/shared";

// CRITICAL: NodeNext module resolution.
// All relative imports need .js extension:
//   import { escalateToFlash } from "./escalate.js"; // NOT "./escalate"

// CRITICAL: Do not pipeline ProfileStore.get with AuditStore.put.
// Tempting (one Redis round-trip) but couples the SLA-binding read to a
// non-SLA-binding write. Different code paths, different timing.

// CRITICAL: policy.match is a foundation stub returning hardcoded shape.
// Do NOT call the real stub and expect it to vary by input.
// Tests inject a mock PolicyMatcher via DI — shape the mock per test case.

// CRITICAL: Fastify hooks compound latency.
// Each onRequest/preHandler adds ~1-3ms. Don't add logging/metrics/auth hooks
// as separate Fastify hooks — the bench script will catch the creep.

// CRITICAL: DENY is the default, not ALLOW.
// The outermost try/catch must return DENY. ALLOW is never the default path.
// Every branch that ALLOWs must do so explicitly through the verdict pipeline.

// IMPORTANT: Prompt injection vector on page-content in Flash prompt.
// Profile signals (categories, detectedEntities) must be passed as structured
// JSON (not interpolated text strings). response_format: { type: "json_object" }
// and max_tokens: 32 bound the output to only the expected shape.

// IMPORTANT: Tenant mismatch → DENY, not 404.
// PolicyStore.get(policyId, advertiserId) returning null must produce:
//   Reason{ kind: "fail_closed", ref: "tenant_mismatch" }
// NOT a 404 response. A 404 would let an adversary enumerate policy IDs.

// IMPORTANT: No _lobstertrap content in the verdict response body.
// Only lobstertrapTraceId (the trace ID) flows to the advertiser.
// Declared-intent payloads and Lobster Trap metadata stay server-side.
```

---

## Security Guardrails

These are non-negotiable. PR review blocks on any violation.

1. **No `GEMINI_API_KEY` read in gate**.
   `process.env.GEMINI_API_KEY` is forbidden in `packages/gate/**`. The ESLint
   rule from foundation task 3 also blocks `import openai` — do not suppress it.

2. **All Flash calls through `LlmClient`** (never `import OpenAI from "openai"` in gate).
   Tests must assert `lobstertrapTraceId` is non-null on every ambiguous-path verdict.
   A null trace ID on an ambiguous path is a bypass — it must fail the test suite.

3. **Tenant scoping**: gate calls `PolicyStore.get(policyId, advertiserId)`, never
   `PolicyStore.get(policyId)`. On null return → DENY with
   `Reason{kind:"fail_closed",ref:"tenant_mismatch"}` (not 404).

4. **Fail-closed default**: outermost `try/catch` returns DENY with
   `Reason{kind:"fail_closed",ref:"handler_exception"}`. ALLOW is never the default.

5. **Lobster Trap DENY short-circuits Flash text**: if `result.verdict === "DENY"`,
   gate returns DENY regardless of what Gemini said in `result.content`.

6. **Flash prompt uses structured JSON for profile signals** (not interpolated text).
   Injection defense: content is `JSON.stringify({ profileSignals, policyContext })`,
   response is bound via `response_format: { type: "json_object" }` + `max_tokens: 32`.

7. **Schema validation at every boundary**:
   - Input: `BidVerificationRequestSchema.safeParse(req.body)` at route entry
   - Output: `VerificationVerdictSchema.parse(params)` inside `assembleVerdict()`
   - No schemas inside `@scout/gate` except the import from `@scout/shared`

8. **No `_lobstertrap` content in response body**. Only `lobstertrapTraceId` (the
   trace ID string) appears in `VerificationVerdict`. Full Lobster Trap metadata
   stays server-side.

9. **`gate_audit_dropped` metric**: if `AuditStore.put()` in the deferred
   `setImmediate` throws, catch and increment a counter (even if just a `console.error`
   for the hackathon). Silent audit loss must be detectable.

---

## Implementation Blueprint

### Open Questions — Resolved (lock before coding)

| Question | Recommended Answer | Rationale |
|---|---|---|
| Where does "ambiguous" come from? | `PolicyMatchResult.confidence < Policy.escalation.humanReviewThreshold` (Option A) | Schema already exposes the dial; advertiser-controllable; plug-and-play |
| Cache-miss queue topology | `ProfileQueue` from `@scout/store` (Option A) | Foundation commits to Redis; consume the interface |
| Flash prompt location | Inline in `packages/gate/src/escalate.ts` (Option A) | Different shape and latency from arbiter; do not conflate |
| Audit write timing | Fire-and-forget via `setImmediate` after `reply.send()` (Option A) | Architecture doc puts audit on warm side; bounded retry covers failure |

### Latency Budget (this PRP owns these numbers)

| Stage | P95 Budget | Notes |
|---|---|---|
| Fastify lifecycle + zod parse + response serialize | ≤ 50ms | No extra hooks; collapse if needed |
| `ProfileStore.get` (Redis GET) | ≤ 20ms | Single GET, not pipelined |
| `policy.match` (pure) | ≤ 1ms | No I/O |
| Flash escalation (ambiguous path only) | ≤ 400ms hard abort | `AbortSignal.timeout(400)` |
| `AuditStore.put` + `ProfileQueue.enqueue` | **NOT COUNTED** | Deferred via `setImmediate` |
| **Total P99 end-to-end** | **≤ 1000ms** | |

### Pipeline Decision Tree

```
POST /verify
│
├─ safeParse(body) fails → 400 + zod error (no audit, no enqueue)
│
├─ ProfileStore.get(pageUrl) → null OR isTtlExpired(profile)
│   └─ setImmediate: ProfileQueue.enqueue({url, advertiserId, policyId})
│   └─ DENY, reason: fail_closed/cache_miss, profileId: null → 200
│
├─ PolicyStore.get(policyId, advertiserId) → null
│   └─ DENY, reason: fail_closed/tenant_mismatch, profileId: profile.id → 200
│
├─ policyMatcher.match(profile, policy) → matchResult
│   │
│   ├─ !matchResult.ambiguous → clear-cut
│   │   └─ verdict = matchResult.decision + buildReasonsFromMatch → 200
│   │
│   └─ matchResult.ambiguous OR matchResult.decision === "HUMAN_REVIEW"
│       │
│       ├─ policy.escalation.ambiguousAction === "HUMAN_REVIEW"
│       │   └─ HUMAN_REVIEW + reason: arbiter_disagreement/policy_escalation → 200
│       │
│       └─ escalateToFlash(llmClient, profile, policy)
│           ├─ Flash → ALLOW, lobstertrapTraceId non-null → 200 ALLOW
│           ├─ Flash → DENY, lobstertrapTraceId non-null → 200 DENY
│           ├─ Lobster Trap verdict === "DENY" → DENY, ref: lobstertrap_denied → 200
│           └─ timeout / error → DENY, ref: flash_timeout|lobstertrap_unavailable → 200
│
└─ (all paths) setImmediate: AuditStore.put({id, requestId, verdict, request, createdAt})
   (any path) handler throws → catch → 500 DENY, ref: handler_exception
```

### Pseudocode — `packages/gate/src/handler.ts` (≤150 lines)

```typescript
import type { FastifyRequest, FastifyReply } from "fastify";
import type { ProfileStore, PolicyStore, AuditStore, ProfileQueue } from "@scout/store";
import type { LlmClient } from "@scout/llm-client";
import type { PolicyMatcher } from "@scout/policy";
import type { PageProfile, BidVerificationRequest, VerificationVerdict } from "@scout/shared";
import { BidVerificationRequestSchema } from "@scout/shared";
import { escalateToFlash } from "./escalate.js";
import { assembleVerdict, buildReasonsFromMatch, failClosedVerdict } from "./verdict.js";

export interface GateDeps {
  profileStore: ProfileStore;
  policyStore: PolicyStore;
  auditStore: AuditStore;
  profileQueue: ProfileQueue;
  llmClient: LlmClient;
  policyMatcher: PolicyMatcher;
}

function isTtlExpired(profile: PageProfile): boolean {
  // CRITICAL: profile.ttl is SECONDS, multiply by 1000 for ms comparison
  return Date.now() > new Date(profile.capturedAt).getTime() + profile.ttl * 1000;
}

export function createHandler(deps: GateDeps) {
  return async function handler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const start = Date.now();
    let verdict: VerificationVerdict | undefined;

    try {
      // 1. Parse — fail fast on malformed input; never produce a verdict on parse failure
      const parsed = BidVerificationRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        await reply.code(400).send({ error: parsed.error.flatten() });
        return;
      }
      const body: BidVerificationRequest = parsed.data;

      // 2. Profile lookup
      const profile = await deps.profileStore.get(body.pageUrl);

      // 3. Cache miss or TTL expired → fail-closed; enqueue for warm path
      if (profile === null || isTtlExpired(profile)) {
        setImmediate(() => {
          void deps.profileQueue
            .enqueue({ url: body.pageUrl, advertiserId: body.advertiserId, policyId: body.policyId, requestedAt: new Date().toISOString() })
            .catch((e: unknown) => { console.error("[gate] profile_queue_enqueue_failed", e); });
        });
        verdict = failClosedVerdict("cache_miss", Date.now() - start);
        await reply.send(verdict);
        return;
      }

      // 4. Policy lookup — MUST be tenant-scoped (policyId + advertiserId together)
      const policy = await deps.policyStore.get(body.policyId, body.advertiserId);
      if (policy === null) {
        // Return DENY (not 404) to prevent policy-ID enumeration by adversaries
        verdict = failClosedVerdict("tenant_mismatch", Date.now() - start, profile.id, "");
        await reply.send(verdict);
        return;
      }

      // 5. Policy match (pure function — no I/O, ≤1ms)
      const matchResult = deps.policyMatcher.match(profile, policy);

      // 6. Clear-cut decision (non-ambiguous, non-HUMAN_REVIEW)
      if (!matchResult.ambiguous && matchResult.decision !== "HUMAN_REVIEW") {
        verdict = assembleVerdict({
          decision: matchResult.decision,
          reasons: buildReasonsFromMatch(matchResult),
          profileId: profile.id,
          policyVersion: policy.version,
          latencyMs: Date.now() - start,
          lobstertrapTraceId: null,
        });
        await reply.send(verdict);
        return;
      }

      // 7. Ambiguous / HUMAN_REVIEW — check escalation policy
      if (policy.escalation.ambiguousAction === "HUMAN_REVIEW" || matchResult.decision === "HUMAN_REVIEW") {
        verdict = assembleVerdict({
          decision: "HUMAN_REVIEW",
          reasons: [
            ...buildReasonsFromMatch(matchResult),
            { kind: "arbiter_disagreement", ref: "policy_escalation", detail: "Escalation policy set to HUMAN_REVIEW for ambiguous matches" },
          ],
          profileId: profile.id,
          policyVersion: policy.version,
          latencyMs: Date.now() - start,
          lobstertrapTraceId: null,
        });
        await reply.send(verdict);
        return;
      }

      // 8. Flash escalation — only when ambiguous AND policy permits Flash
      const escalation = await escalateToFlash(deps.llmClient, profile, policy);
      verdict = assembleVerdict({
        decision: escalation.decision,
        reasons: [...buildReasonsFromMatch(matchResult), ...escalation.reasons],
        profileId: profile.id,
        policyVersion: policy.version,
        latencyMs: Date.now() - start,
        lobstertrapTraceId: escalation.lobstertrapTraceId,
      });
      await reply.send(verdict);

    } catch (err: unknown) {
      // Fail-closed on ALL unexpected errors — ALLOW is never the default
      verdict = failClosedVerdict("handler_exception", Date.now() - start);
      console.error("[gate] handler_exception", err);
      await reply.code(500).send(verdict);

    } finally {
      // Deferred audit — NEVER blocks the response (setImmediate = after reply)
      if (verdict !== undefined) {
        const v = verdict;
        setImmediate(() => {
          void deps.auditStore
            .put({ id: crypto.randomUUID(), requestId: String(Date.now()), verdict: v, request: (req.body as BidVerificationRequest), createdAt: new Date().toISOString() })
            .catch((e: unknown) => { console.error("[gate] gate_audit_dropped", e); });
        });
      }
    }
  };
}
```

**Note on `failClosedVerdict` signature**: accepts optional `profileId` and `policyVersion`
overloads so tenant_mismatch can carry `profile.id` even though the policy wasn't found.
Define two overloads in `verdict.ts` or use optional params.

### Pseudocode — `packages/gate/src/escalate.ts` (≤110 lines)

```typescript
import type { LlmClient } from "@scout/llm-client";
import type { PageProfile, Policy, Decision, Reason } from "@scout/shared";

// Model pinned per foundation lock — never "-latest"
const ESCALATION_MODEL = "gemini-2.5-flash";
const FLASH_TIMEOUT_MS = 400;
const FLASH_MAX_TOKENS = 32; // only need {"decision":"ALLOW"} or {"decision":"DENY"}

export interface EscalationResult {
  decision: Decision;
  lobstertrapTraceId: string | null;
  reasons: Reason[];
}

export async function escalateToFlash(
  llmClient: LlmClient,
  profile: PageProfile,
  policy: Policy,
): Promise<EscalationResult> {

  // Structured JSON inputs — NEVER interpolate profile text directly into prompt
  // This is the prompt-injection defense; LobsterTrap inspects this payload too
  const profileSignals = {
    categories: profile.categories.map(c => ({ label: c.label, confidence: c.confidence })),
    detectedEntities: profile.detectedEntities.map(e => ({ name: e.name, type: e.type })),
  };
  const policyContext = {
    rules: policy.rules.map(r => ({ kind: r.kind, match: r.match, action: r.action })),
  };

  let result: Awaited<ReturnType<LlmClient["chat"]>>;
  try {
    result = await llmClient.chat(
      {
        model: ESCALATION_MODEL,
        messages: [
          {
            role: "system",
            content:
              'You are a brand-safety classifier. Given the page profile signals and policy rules, ' +
              'determine if this page clears brand-safety criteria. ' +
              'Reply with ONLY valid JSON: {"decision":"ALLOW"} or {"decision":"DENY"}. No other text.',
          },
          {
            role: "user",
            content: JSON.stringify({ profileSignals, policyContext }),
          },
        ],
        response_format: { type: "json_object" },
        max_tokens: FLASH_MAX_TOKENS,
        signal: AbortSignal.timeout(FLASH_TIMEOUT_MS),
      },
      {
        declared_intent: "brand-safety-flash-escalation",
        agent_id: "gate",
        declared_paths: ["profile.categories", "profile.detectedEntities", "policy.rules"],
      },
    );
  } catch (err: unknown) {
    // AbortError = timeout; anything else = infrastructure failure
    const ref =
      err instanceof Error && err.name === "AbortError"
        ? "flash_timeout"
        : "lobstertrap_unavailable";
    return {
      decision: "DENY",
      lobstertrapTraceId: null,
      reasons: [{ kind: "fail_closed", ref, detail: err instanceof Error ? err.message : "Unknown Flash error" }],
    };
  }

  // CRITICAL: Lobster Trap verdict takes precedence over model text
  // DPI may have detected prompt-injection or policy violation independent of Gemini
  if (result.verdict === "DENY" || result.verdict === "QUARANTINE") {
    return {
      decision: "DENY",
      lobstertrapTraceId: result.lobstertrapTraceId,
      reasons: [{ kind: "fail_closed", ref: "lobstertrap_denied", detail: `Lobster Trap DPI verdict: ${result.verdict}` }],
    };
  }

  // Parse model response — any failure → fail-closed DENY
  let modelDecision: Decision = "DENY";
  try {
    const parsed: unknown = JSON.parse(result.content);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "decision" in parsed &&
      (parsed as Record<string, unknown>)["decision"] === "ALLOW"
    ) {
      modelDecision = "ALLOW";
    }
  } catch {
    // Malformed JSON → keep fail-closed DENY
  }

  return {
    decision: modelDecision,
    lobstertrapTraceId: result.lobstertrapTraceId,
    reasons: [
      {
        kind: "profile_signal",
        ref: "flash_escalation",
        detail: `Gemini Flash classified: ${modelDecision} (lobstertrap: ${result.verdict})`,
      },
    ],
  };
}
```

### Pseudocode — `packages/gate/src/verdict.ts` (≤80 lines)

```typescript
import { VerificationVerdictSchema } from "@scout/shared";
import type { VerificationVerdict, Reason, Decision } from "@scout/shared";
import type { PolicyMatchResult } from "@scout/policy";

export function assembleVerdict(params: {
  decision: Decision;
  reasons: Reason[];
  profileId: string | null;
  policyVersion: string;
  latencyMs: number;
  lobstertrapTraceId: string | null;
}): VerificationVerdict {
  // Defense-in-depth: parse validates against schema before the value leaves this module.
  // Catches shape drift while the system is still half-stub.
  return VerificationVerdictSchema.parse(params);
}

export function buildReasonsFromMatch(matchResult: PolicyMatchResult): Reason[] {
  return matchResult.matchedRules.map(rule => ({
    kind: "policy_rule" as const,
    ref: rule.ruleId,
    detail: `${rule.kind} rule matched '${rule.matchedValue}' → ${rule.action}`,
  }));
}

export function failClosedVerdict(
  ref: string,
  latencyMs: number,
  profileId: string | null = null,
  policyVersion = "",
): VerificationVerdict {
  return VerificationVerdictSchema.parse({
    decision: "DENY" as const,
    reasons: [{ kind: "fail_closed", ref, detail: "Fail-closed default" }],
    profileId,
    policyVersion,
    latencyMs,
    lobstertrapTraceId: null,
  });
}
```

### Pseudocode — `packages/gate/src/index.ts` (modified from foundation stub)

```typescript
import Fastify from "fastify";
import { createLlmClient } from "@scout/llm-client";
import { createStores } from "@scout/store";
import { createPolicyMatcher } from "@scout/policy";
import { createHandler, type GateDeps } from "./handler.js";

export function createApp(deps: GateDeps) {
  const app = Fastify({ logger: { level: "warn" } }); // suppress hook logs on hot path

  app.post<{ Body: unknown }>("/verify", createHandler(deps));
  return app;
}

// Entry point (not exported — only called from CLI)
if (process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  const deps: GateDeps = {
    ...createStores(),
    llmClient: createLlmClient(),
    policyMatcher: createPolicyMatcher(),
  };
  const app = createApp(deps);
  await app.listen({ port: 3000, host: "0.0.0.0" });
  console.log("[gate] listening on :3000");
}
```

### Pseudocode — `packages/gate/scripts/bench-verify.ts` (≤100 lines)

```typescript
// 100-req synthetic benchmark. @scout/llm-client is mocked at the LlmClient
// interface level (not the OpenAI SDK level) to simulate 200ms ±jitter Flash.
// Mix: 70% cache-hit-clear, 20% cache-hit-ambiguous, 10% cache-miss.
// Pass: P50<250ms, P95<600ms, P99<1000ms.
// Failure: log results to PLANNING.md §Hot-path runtime; decide Node+Fastify vs Bun+Hono.

import { createApp } from "../src/index.js";
// ... build mock deps matching the 70/20/10 mix
// ... fire 100 inject() calls, record latencyMs from verdict
// ... compute percentiles from the latencyMs array
// ... assert thresholds or print FAIL with recommendation
```

The benchmark should:
1. Build in-memory mock implementations for all stores (no Redis needed)
2. Mock `LlmClient.chat` to resolve after `200 + Math.random() * 100` ms on ambiguous calls
3. Use `app.inject()` for accurate Fastify overhead measurement (not raw handler calls)
4. Compute P50, P95, P99 from the `verdict.latencyMs` field in responses
5. Exit code 1 on threshold violation (so CI can catch it)
6. Print the percentiles whether passing or failing

---

## Task Order (commit-sized)

### Task 0 — Verify foundation contracts exist (pre-flight, no code)

```bash
# Verify these are NOT still stub exports before writing any gate code:
node -e "import('@scout/store').then(m => console.log(Object.keys(m)))"
node -e "import('@scout/llm-client').then(m => console.log(Object.keys(m)))"
node -e "import('@scout/policy').then(m => console.log(Object.keys(m)))"
```

If any print `[]` (empty), complete the corresponding foundation tasks first.

### Task 1 — Update `packages/gate/package.json`

Add missing dependencies. Gate currently only has `@scout/shared`. Needs:

```json
{
  "dependencies": {
    "@scout/shared": "workspace:*",
    "@scout/store": "workspace:*",
    "@scout/llm-client": "workspace:*",
    "@scout/policy": "workspace:*",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "bench": "tsx scripts/bench-verify.ts"
  }
}
```

Run `pnpm install` after updating. Verify `pnpm --filter @scout/gate exec tsc --noEmit` passes.

### Task 2 — Create `packages/gate/src/verdict.ts`

Implement `assembleVerdict`, `buildReasonsFromMatch`, `failClosedVerdict`. No imports
from `fastify`, `@scout/store`, `@scout/llm-client`. Only `@scout/shared` and `@scout/policy`.

Write the first two tests before writing the module:
- `assembleVerdict` with valid params → passes `VerificationVerdictSchema.parse`
- `assembleVerdict` with invalid decision → throws (zod error, not silent)

### Task 3 — Create `packages/gate/src/escalate.ts`

Implement `escalateToFlash`. Dependencies: `LlmClient` (injected), `PageProfile`, `Policy`.
No imports from `fastify`, `@scout/store`.

Write tests with a mock `LlmClient` before writing the module body:
- Mock returns `{ content: '{"decision":"ALLOW"}', lobstertrapTraceId: "t1", verdict: "ALLOW" }` → ALLOW, `lobstertrapTraceId: "t1"`
- Mock returns `{ verdict: "DENY", lobstertrapTraceId: "t2", content: '{"decision":"ALLOW"}' }` → DENY even though model said ALLOW
- Mock `signal.abort()` path (never-resolving promise + fake timers) → DENY, `ref: "flash_timeout"`

### Task 4 — Create `packages/gate/src/handler.ts`

Implement `createHandler(deps)`. Follow the pipeline decision tree above exactly.

Write tests in order (per feature file § Test order):
1. zod request-body validation (400 on bad body, no AuditStore.put, no ProfileQueue.enqueue)
2. Cache-hit clear ALLOW / DENY
3. Cache-miss + ProfileQueue.enqueue called exactly once
4. Ambiguous + Flash ALLOW / DENY happy paths
5. Flash timeout failure path (`vi.useFakeTimers()`)
6. Lobster Trap DENY failure path
7. Malformed body
8. Handler throw → 500, DENY, `ref: "handler_exception"`

For each test: use `app.inject()` via `createApp(mockDeps)` — never test the handler function directly.

### Task 5 — Update `packages/gate/src/index.ts`

Replace foundation stub with `createApp(deps)` factory + CLI entry point.

Validation: `pnpm --filter @scout/gate typecheck` green. 
Manual smoke: `pnpm dev:gate` → `curl -X POST http://localhost:3000/verify -H "Content-Type: application/json" -d '{"advertiserId":"adv1","policyId":"pol1","pageUrl":"https://example.com","creativeRef":"cr1","geo":"US","ts":"2026-05-15T00:00:00Z"}'` → 200 + valid verdict shape.

### Task 6 — Create exhaustive test suite `packages/gate/src/handler.test.ts`

Complete all 11 test cases from the Test Matrix below. File must stay ≤ 300 lines.
If it exceeds 300 lines, split into:
- `handler.test.ts` — happy paths
- `handler.failure.test.ts` — failure paths + edge cases

Run `pnpm --filter @scout/gate test` — all 11 must pass.

### Task 7 — Create `packages/gate/scripts/bench-verify.ts`

Implement the 100-req benchmark per the pseudocode above.
Run `pnpm --filter @scout/gate bench` and record output.

If P99 < 1000ms: ✅ Node + Fastify confirmed. Note result in `PLANNING.md`.
If P99 ≥ 1000ms: Document the failure in `PLANNING.md § Hot-path runtime` and surface
the Bun + Hono decision — this PRP unlocks it but does not pre-commit to a switch.

---

## Test Matrix (exhaustive — 11 test cases)

All tests use `createApp(mockDeps)` and `app.inject()`. Mock deps via DI (not `vi.mock`)
except for `policyMatcher` which is in the `deps` object and can be replaced per test.

### Setup pattern

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GateDeps } from "./handler.js";
import { createApp } from "./index.js";

function buildDeps(overrides: Partial<GateDeps> = {}): GateDeps {
  return {
    profileStore: { get: vi.fn().mockResolvedValue(validProfile), put: vi.fn() },
    policyStore: { get: vi.fn().mockResolvedValue(validPolicy) },
    auditStore: { put: vi.fn().mockResolvedValue(undefined) },
    profileQueue: { enqueue: vi.fn().mockResolvedValue(undefined) },
    llmClient: { chat: vi.fn(), healthcheck: vi.fn() },
    policyMatcher: { match: vi.fn().mockReturnValue(clearAllowResult) },
    ...overrides,
  };
}
```

### Test Cases

| # | Name | Setup | Expected Response | Key Assertions |
|---|---|---|---|---|
| 1 | **Happy: cache-hit + policy-ALLOW** | profileStore returns valid non-expired profile; policyMatcher returns `{ decision:"ALLOW", ambiguous:false, matchedRules:[...] }` | 200, `decision:"ALLOW"`, `lobstertrapTraceId:null` | `llmClient.chat` NOT called (spy assertion) |
| 2 | **Happy: cache-hit + policy-DENY** | policyMatcher returns `{ decision:"DENY", ambiguous:false, matchedRules:[{ruleId:"r1",...}] }` | 200, `decision:"DENY"`, reasons include `kind:"policy_rule", ref:"r1"` | No Flash call |
| 3 | **Happy: cache-hit + ambiguous + Flash→ALLOW** | policyMatcher returns `{ decision:"DENY", ambiguous:true }` (confidence < threshold); llmClient.chat mock returns `{ content:'{"decision":"ALLOW"}', lobstertrapTraceId:"lt-abc", verdict:"ALLOW" }` | 200, `decision:"ALLOW"`, `lobstertrapTraceId:"lt-abc"` non-null | Flash called exactly once; trace ID in verdict |
| 4 | **Happy: cache-hit + ambiguous + Flash→DENY** | Same setup, llmClient.chat returns `{ content:'{"decision":"DENY"}', lobstertrapTraceId:"lt-xyz", verdict:"ALLOW" }` | 200, `decision:"DENY"`, `lobstertrapTraceId:"lt-xyz"` | lobstertrapTraceId recorded even on DENY verdict |
| 5 | **Edge: cache-miss** | profileStore returns null | 200, `decision:"DENY"`, `reasons[0]:{kind:"fail_closed",ref:"cache_miss"}` | `profileQueue.enqueue` called exactly once with `{url, advertiserId, policyId}`; `auditStore.put` fired (setImmediate) |
| 6 | **Edge: TTL expired** | profileStore returns profile with `capturedAt` 2 hours ago and `ttl: 3600` (expired by 1 second: `capturedAt + 3600*1000 < Date.now()`) | Same as cache-miss: DENY, ref:"cache_miss" | enqueue called; treats expired === miss |
| 7 | **Edge: arbiter disagreement on profile** | policyMatcher returns `{ decision:"HUMAN_REVIEW", ambiguous:true, matchedRules:[] }` (arbiter flagged this profile in warm path) | 200, `decision:"HUMAN_REVIEW"`, `reasons` include `kind:"arbiter_disagreement"` | No Flash call (HUMAN_REVIEW comes from match result, not Flash) |
| 8 | **Failure: Flash never resolves (timeout)** | `vi.useFakeTimers()`; llmClient.chat returns never-resolving promise; advance timers past 400ms | 200, `decision:"DENY"`, `reasons[0]:{kind:"fail_closed",ref:"flash_timeout"}` | No promise leak after handler returns (check with `vi.runAllTimers()`) |
| 9 | **Failure: Lobster Trap verdict="DENY"** | llmClient.chat returns `{ content:'{"decision":"ALLOW"}', verdict:"DENY", lobstertrapTraceId:"lt-deny" }` | 200, `decision:"DENY"`, `ref:"lobstertrap_denied"`, `lobstertrapTraceId:"lt-deny"` | lobstertrapTraceId still recorded — it's the audit-trail proof point |
| 10 | **Failure: malformed body** | POST with body `{advertiserId:""}` (policyId missing) | 400, zod error in body | `auditStore.put` NOT called; `profileQueue.enqueue` NOT called |
| 11 | **Failure: handler throws** | policyStore.get throws `new Error("redis timeout")` | 500, `decision:"DENY"`, `ref:"handler_exception"` | No stack trace in response body; `auditStore.put` fired with fail-closed verdict |

---

## Bench Script Thresholds

```
Benchmark target: 100 requests, mixed workload:
  - 70 requests: cache-hit + clear-cut policy (no Flash)
  - 20 requests: cache-hit + ambiguous + Flash (mocked: 200ms + up to 100ms jitter)
  - 10 requests: cache-miss (DENY immediately)

PASS thresholds:
  P50 < 250ms
  P95 < 600ms
  P99 < 1000ms

On FAIL:
  - Print all percentiles
  - Print: "FAIL: Node+Fastify P99 exceeds budget. Document in PLANNING.md and
    evaluate Bun+Hono. Foundation Q2 decision required before demo."
  - Exit with code 1
```

---

## Validation Gates (executable)

Run in this exact order. Fix failures before proceeding to the next gate.

```bash
# Gate 0: Pre-flight — confirm foundation contracts exist
pnpm --filter @scout/gate exec node -e "import('@scout/store').then(m => { if (!('createStores' in m)) throw new Error('missing createStores'); console.log('store OK'); })"
pnpm --filter @scout/gate exec node -e "import('@scout/llm-client').then(m => { if (!('createLlmClient' in m)) throw new Error('missing createLlmClient'); console.log('llm-client OK'); })"
pnpm --filter @scout/gate exec node -e "import('@scout/policy').then(m => { if (!('createPolicyMatcher' in m)) throw new Error('missing createPolicyMatcher'); console.log('policy OK'); })"

# Gate 1: Type checking (strict — no `any` without // Reason: comment)
pnpm --filter @scout/gate exec tsc --noEmit

# Gate 2: Linting + formatting
pnpm --filter @scout/gate exec eslint . --fix
pnpm --filter @scout/gate exec prettier --write .

# Gate 3: Unit tests — must be 11/11 passing
pnpm --filter @scout/gate test

# Gate 4: Build verification
pnpm --filter @scout/gate build 2>/dev/null || echo "NOTE: noEmit mode — no build artifact"

# Gate 5: Security audit
pnpm --filter @scout/gate audit

# Gate 6: ESLint boundary check (foundation task 3 — verify no openai import in gate)
grep -r "import.*openai" packages/gate/src/ && echo "FAIL: direct openai import in gate" || echo "ESLint boundary OK"
grep -r "GEMINI_API_KEY" packages/gate/src/ && echo "FAIL: GEMINI_API_KEY read in gate" || echo "API key guard OK"

# Gate 7: Latency benchmark (run after all unit tests pass)
pnpm --filter @scout/gate bench
# Expected output: P50: Xms | P95: Xms | P99: Xms | PASS (or FAIL with instructions above)

# Gate 8: Manual end-to-end smoke
# In one terminal:
pnpm dev:gate
# In another terminal (valid request):
curl -s -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{"advertiserId":"adv1","policyId":"pol1","pageUrl":"https://example.com","creativeRef":"cr1","geo":"US","ts":"2026-05-15T00:00:00Z"}' \
  | jq .
# Expected: { decision: "DENY"|"ALLOW"|"HUMAN_REVIEW", reasons: [...], latencyMs: N, lobstertrapTraceId: null|"..." }

# Gate 9: Bad body → 400
curl -s -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{"advertiserId":""}' \
  | jq .
# Expected: { error: { fieldErrors: {...} } }
```

---

## Final Checklist

- [ ] Project docs (`CLAUDE.md`, `HACKATHON-CONTEXT.md`, `features/architecture.md`) honored
- [ ] All four hackathon constraints preserved (sub-second / pre-bid / plug-and-play / sponsor-tech)
- [ ] Security guardrails section implemented: no `GEMINI_API_KEY` in gate, tenant-scoped policy lookup, fail-closed default, structured JSON Flash prompt, schema validation at input and output boundaries
- [ ] `lobstertrapTraceId` non-null on every ambiguous-path verdict (test #3, #4, #9 assert this)
- [ ] TTL check uses `* 1000` (seconds → ms conversion) — tested via test case #6
- [ ] `AbortSignal.timeout(400)` passed as `signal` in LlmChatArgs for all Flash calls
- [ ] Lobster Trap `verdict === "DENY"` short-circuits Flash text response (test #9)
- [ ] `PolicyStore.get(policyId, advertiserId)` — never missing the advertiserId arg
- [ ] Tenant mismatch returns DENY (not 404), `ref:"tenant_mismatch"`
- [ ] `AuditStore.put` called via `setImmediate` (not awaited before reply)
- [ ] `ProfileQueue.enqueue` called once on cache-miss (test #5 asserts exact call count)
- [ ] Handler body ≤ 150 lines; `escalate.ts` ≤ 110 lines; `verdict.ts` ≤ 80 lines
- [ ] Test file ≤ 300 lines (split into `handler.test.ts` + `handler.failure.test.ts` if needed)
- [ ] All 11 test cases implemented and passing
- [ ] Bench script produces P50/P95/P99 output and exits 1 on threshold violation
- [ ] `PLANNING.md` updated with bench results (pass or fail + Q2 decision if fail)
- [ ] All imports use `.js` extensions (NodeNext); type-only imports use `import type`
- [ ] No `any` without `// Reason:` comment
- [ ] `noUncheckedIndexedAccess`: all array accesses guarded (use `.map()` over index access)
- [ ] `failClosedVerdict` default is DENY — ALLOW never emitted implicitly
- [ ] `assembleVerdict` calls `VerificationVerdictSchema.parse()` as defense-in-depth

---

## Anti-Patterns to Avoid

- ❌ Don't `import OpenAI from "openai"` in any gate file — ESLint blocks it; it's also wrong architecture
- ❌ Don't read `process.env.GEMINI_API_KEY` in gate — it lives in `@scout/llm-client/config.ts`
- ❌ Don't `await AuditStore.put()` before `reply.send()` — it couples SLA to audit latency
- ❌ Don't `await ProfileQueue.enqueue()` on the hot path — setImmediate only
- ❌ Don't pipeline `ProfileStore.get` with `AuditStore.put` — different timing paths
- ❌ Don't call `PolicyStore.get(policyId)` without `advertiserId` — tenant isolation
- ❌ Don't return 404 on policy-not-found — adversaries can enumerate policy IDs; return DENY
- ❌ Don't let ALLOW be the default on any uncovered code path — fail-closed means DENY is default
- ❌ Don't trust `result.content` when `result.verdict === "DENY"` — Lobster Trap wins
- ❌ Don't interpolate profile text into the Flash system prompt — use `JSON.stringify(profileSignals)`
- ❌ Don't pin `"gemini-2.5-flash-latest"` — use `"gemini-2.5-flash"` exactly
- ❌ Don't call `policy.match` in tests without mocking — the foundation stub returns a fixed shape and will not vary by input
- ❌ Don't add multiple Fastify hooks (onRequest, preHandler, etc.) — latency adds up; bench will catch it

---

## Confidence: 9 / 10

**High confidence because:**
- Feature file is unusually specific: exact file names, line limits, test cases, latency budget, open-question resolutions, and security guardrails are all pre-decided
- Shared schemas are already implemented and match the feature file exactly (verified from live code)
- Foundation PRP lays out all consuming contracts (LlmClient, store interfaces, policy stub) in detail
- The pipeline decision tree is explicit with no ambiguous branches
- All three open questions have a recommended answer — no design decisions left to the implementing agent

**Residual risk (1/10):**
- Foundation must be completed first. If `@scout/store`, `@scout/llm-client`, or `@scout/policy` interfaces diverge from what's documented here (e.g., different `LlmClient.chat` signature or different `ProfileStore.get` arity), the gate implementation must adapt to the actual contracts. Run Task 0 pre-flight before writing any gate code.
- `AbortSignal.timeout` socket-level abort is not guaranteed — documented in gotchas; acceptable for hackathon scope.
- `PolicyMatchResult.ambiguous` is a proposed field. If foundation's stub uses a different shape, update `isTtlExpired` and the ambiguity check in `handler.ts` to derive `ambiguous` from `confidence < policy.escalation.humanReviewThreshold` inline.
