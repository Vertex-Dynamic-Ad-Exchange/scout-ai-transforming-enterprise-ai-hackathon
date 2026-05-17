import type { AuditRow } from "@scout/shared";

/**
 * The five on-stage demo scenarios (FEATURE-TODO.md:84-89; feature spec
 * line 86). All field values are DETERMINISTIC literals — no
 * `Math.random`, no `Date.now()`, no environment reads. Tests run the
 * same fixture every invocation; the on-stage replayer
 * (`demo-bidstream-seeding.md`) consumes the SAME file so the test bed
 * and the live demo render identical rows.
 *
 * Security guardrail (PRP 07): every value here is **intentionally
 * fake**. No real Gemini responses, no real Lobster Trap trace IDs, no
 * real advertiser IDs, no real evidence URIs. Refresh whenever the
 * upstream schemas grow.
 *
 * Schema commitment: every `row` here MUST parse against
 * `AuditRowSchema` from `@scout/shared` — the colocated test asserts
 * this. If a schema field is added upstream, this file must add it too
 * (or the test fails fast).
 */
export type DemoScenario = { name: string; row: AuditRow };

const ADVERTISER = "demo-advertiser";

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    name: "Clean ALLOW",
    row: {
      kind: "verdict",
      id: "demo-row-1",
      advertiserId: ADVERTISER,
      ts: "2026-05-17T12:00:00.000Z",
      request: {
        advertiserId: ADVERTISER,
        policyId: "policy-fashion-v1",
        pageUrl: "https://demo.example.com/fashion-landing",
        creativeRef: "creative-fashion-001",
        geo: "US",
        ts: "2026-05-17T12:00:00.000Z",
      },
      verdict: {
        decision: "ALLOW",
        reasons: [
          {
            kind: "policy_rule",
            ref: "rule.allow.fashion",
            detail: "Page profile matches advertiser allow list",
          },
        ],
        profileId: "profile-fashion-1",
        policyVersion: "policy-v1",
        latencyMs: 142,
        lobstertrapTraceId: "trace-001",
      },
      profile: null,
      declaredIntent: {
        declared_intent: "classify page against advertiser policy, ALLOW or DENY only",
        agent_id: "gate.flash",
      },
      detectedIntent: {
        detected_intent: "classify page against advertiser policy, ALLOW or DENY only",
        divergence: null,
        evidence: null,
      },
    },
  },
  {
    name: "Clean DENY",
    row: {
      kind: "verdict",
      id: "demo-row-2",
      advertiserId: ADVERTISER,
      ts: "2026-05-17T12:01:00.000Z",
      request: {
        advertiserId: ADVERTISER,
        policyId: "policy-alcohol-v1",
        pageUrl: "https://demo.example.com/alcohol-landing",
        creativeRef: "creative-bev-002",
        geo: "US",
        ts: "2026-05-17T12:01:00.000Z",
      },
      verdict: {
        decision: "DENY",
        reasons: [
          {
            kind: "policy_rule",
            ref: "rule.deny.alcohol",
            detail: "Page profile matches advertiser deny list",
          },
        ],
        profileId: "profile-alcohol-1",
        policyVersion: "policy-v1",
        latencyMs: 188,
        lobstertrapTraceId: "trace-002",
      },
      profile: null,
      declaredIntent: {
        declared_intent: "classify page against alcohol-deny policy",
        agent_id: "gate.flash",
      },
      detectedIntent: {
        detected_intent: "classify page against alcohol-deny policy",
        divergence: null,
        evidence: null,
      },
    },
  },
  {
    name: "Ambiguous Flash escalation",
    row: {
      kind: "verdict",
      id: "demo-row-3",
      advertiserId: ADVERTISER,
      ts: "2026-05-17T12:02:00.000Z",
      request: {
        advertiserId: ADVERTISER,
        policyId: "policy-news-v1",
        pageUrl: "https://demo.example.com/ambiguous-news",
        creativeRef: "creative-news-003",
        geo: "US",
        ts: "2026-05-17T12:02:00.000Z",
      },
      verdict: {
        decision: "DENY",
        reasons: [
          {
            kind: "fail_closed",
            ref: "flash.escalation",
            detail: "Gate Flash escalation returned DENY for ambiguous category",
          },
        ],
        profileId: "profile-news-1",
        policyVersion: "policy-v1",
        latencyMs: 411,
        lobstertrapTraceId: "trace-003",
      },
      profile: null,
      declaredIntent: {
        declared_intent: "escalate ambiguous category; classify ALLOW or DENY",
        agent_id: "gate.flash",
      },
      detectedIntent: {
        detected_intent: "escalate ambiguous category; classify ALLOW or DENY",
        divergence: null,
        evidence: null,
      },
    },
  },
  {
    name: "HUMAN_REVIEW arbiter disagreement",
    row: {
      kind: "verdict",
      id: "demo-row-4",
      advertiserId: ADVERTISER,
      ts: "2026-05-17T12:03:00.000Z",
      request: {
        advertiserId: ADVERTISER,
        policyId: "policy-broad-v1",
        pageUrl: "https://demo.example.com/jailbreak-attempt",
        creativeRef: "creative-broad-004",
        geo: "US",
        ts: "2026-05-17T12:03:00.000Z",
      },
      verdict: {
        decision: "HUMAN_REVIEW",
        reasons: [
          {
            kind: "arbiter_disagreement",
            ref: "arbiter.text-vs-image",
            detail: "Text classifier said safe, image classifier said unsafe",
          },
        ],
        profileId: "profile-broad-1",
        policyVersion: "policy-v1",
        latencyMs: 612,
        lobstertrapTraceId: "trace-004",
      },
      profile: null,
      declaredIntent: {
        declared_intent: "classify page modalities against broad-safety policy",
        agent_id: "arbiter",
      },
      detectedIntent: {
        detected_intent: "instruction-override attempt observed in image overlay text",
        divergence:
          "Detected scope expanded beyond declared classification — image verifier prompt may have been jailbroken by overlay text",
        evidence: "overlay-text-frame-7",
      },
    },
  },
  {
    name: "Cache-miss DENY (cold)",
    row: {
      kind: "verdict",
      id: "demo-row-5a",
      advertiserId: ADVERTISER,
      ts: "2026-05-17T12:04:00.000Z",
      request: {
        advertiserId: ADVERTISER,
        policyId: "policy-tech-v1",
        pageUrl: "https://demo.example.com/tech-landing",
        creativeRef: "creative-tech-005",
        geo: "US",
        ts: "2026-05-17T12:04:00.000Z",
      },
      verdict: {
        decision: "DENY",
        reasons: [
          {
            kind: "fail_closed",
            ref: "cache.miss",
            detail: "Profile not yet warm; failing closed pending profiler completion",
          },
        ],
        profileId: null,
        policyVersion: "policy-v1",
        latencyMs: 4,
        lobstertrapTraceId: null,
      },
      profile: null,
      declaredIntent: null,
      detectedIntent: null,
    },
  },
  {
    name: "Cache-miss ALLOW (warm)",
    row: {
      kind: "verdict",
      id: "demo-row-5b",
      advertiserId: ADVERTISER,
      ts: "2026-05-17T12:04:30.000Z",
      request: {
        advertiserId: ADVERTISER,
        policyId: "policy-tech-v1",
        pageUrl: "https://demo.example.com/tech-landing",
        creativeRef: "creative-tech-005",
        geo: "US",
        ts: "2026-05-17T12:04:30.000Z",
      },
      verdict: {
        decision: "ALLOW",
        reasons: [
          {
            kind: "policy_rule",
            ref: "rule.allow.tech",
            detail: "Profile warmed; matches allow list",
          },
        ],
        profileId: "profile-tech-1",
        policyVersion: "policy-v1",
        latencyMs: 117,
        lobstertrapTraceId: "trace-005",
      },
      profile: null,
      declaredIntent: {
        declared_intent: "classify page against tech-allow policy",
        agent_id: "gate.flash",
      },
      detectedIntent: {
        detected_intent: "classify page against tech-allow policy",
        divergence: null,
        evidence: null,
      },
    },
  },
];

/**
 * Legacy alias preserved so PRP 04's placeholder import path keeps
 * compiling if anything in the codebase still references it. New code
 * should consume `DEMO_SCENARIOS`. Drop when no callers remain.
 */
export const demoScenarios = DEMO_SCENARIOS;
