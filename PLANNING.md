# PLANNING.md — Architecture Decisions & Status

> Updated as decisions are made. Short rules over polished docs.

## Hot-path runtime (Foundation Q2)

**Decision: Node 20 + Fastify 5 — CONFIRMED**

Bench run (2026-05-15): `gate/scripts/bench-verify.ts` 100-req synthetic benchmark, mixed workload (70% cache-hit-clear / 20% ambiguous+Flash mock / 10% cache-miss):

| Percentile | Result | Budget   | Status  |
| ---------- | ------ | -------- | ------- |
| P50        | 0ms    | < 250ms  | ✅ PASS |
| P95        | 260ms  | < 600ms  | ✅ PASS |
| P99        | 292ms  | < 1000ms | ✅ PASS |

P50 is 0ms because the cache-hit + clear-cut path has negligible latency in-process (no network I/O). The 260ms P95 reflects the Flash mock (200ms + jitter). Node+Fastify is within budget on all percentiles. **No switch to Bun+Hono required.**

## Gate verdict pipeline (PRP: gate-verdict-logic)

**Status: IMPLEMENTED** (2026-05-15)

Packages implemented:

- `@scout/store` — ProfileStore, PolicyStore, AuditStore, ProfileQueue interfaces + in-memory impls
- `@scout/llm-client` — LlmClient interface + createLlmClient() via OpenAI SDK → Lobster Trap → Gemini compat endpoint
- `@scout/policy` — PolicyMatcher interface + createPolicyMatcher() with category/entity rule matching
- `@scout/gate` — Full POST /verify pipeline: zod parse → profile lookup → TTL check → tenant-scoped policy lookup → policy match → conditional Flash escalation → deferred audit

Security properties confirmed:

- No `GEMINI_API_KEY` in gate package ✅
- No direct `openai` import in gate ✅
- Tenant-scoped policy lookup (policyId + advertiserId) ✅
- Fail-closed on all error paths (DENY by default) ✅
- Lobster Trap verdict takes precedence over Flash text ✅
- Structured JSON prompt for Flash (no interpolated profile text) ✅
- Schema validation at input (BidVerificationRequestSchema.safeParse) and output (VerificationVerdictSchema.parse) boundaries ✅
- Deferred audit via setImmediate (never blocks SLA path) ✅

Tests: 11/11 passing.
