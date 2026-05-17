/**
 * 100-req synthetic benchmark for POST /verify.
 * Mix: 70% cache-hit-clear, 20% cache-hit-ambiguous+Flash, 10% cache-miss.
 * PASS: P50 < 250ms, P95 < 600ms, P99 < 1000ms.
 * Failure: logs to PLANNING.md note and exits 1.
 */
import type { PageProfile, Policy } from "@scout/shared";
import type { PolicyMatchResult } from "@scout/policy";
import type { GateDeps } from "../src/handler.js";
import { createApp } from "../src/index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const freshProfile: PageProfile = {
  id: "bench-profile-1",
  url: "https://bench.example.com",
  contentHash: "bench-hash",
  categories: [{ label: "news", confidence: 0.9 }],
  detectedEntities: [],
  evidenceRefs: [],
  capturedAt: new Date().toISOString(),
  ttl: 3600,
};

const benchPolicy: Policy = {
  id: "bench-pol1",
  version: "v1",
  advertiserId: "bench-adv1",
  rules: [{ id: "r1", kind: "category", match: "news", action: "ALLOW" }],
  escalation: { ambiguousAction: "ALLOW", humanReviewThreshold: 0.7 },
};

const clearResult: PolicyMatchResult = {
  decision: "ALLOW",
  confidence: 0.9,
  firedRules: [{ ruleId: "r1", kind: "category", signalConfidence: 0.9 }],
  policyVersion: "v1",
};

const ambiguousResult: PolicyMatchResult = {
  decision: "DENY",
  confidence: 0.5,
  firedRules: [{ ruleId: "r1", kind: "category", signalConfidence: 0.5 }],
  policyVersion: "v1",
};

const validBody = {
  advertiserId: "bench-adv1",
  policyId: "bench-pol1",
  pageUrl: "https://bench.example.com",
  creativeRef: "bench-cr1",
  geo: "US",
  ts: new Date().toISOString(),
};

// ── Request type assignment ───────────────────────────────────────────────────

type ReqKind = "clear" | "ambiguous" | "miss";

function assignKind(i: number): ReqKind {
  if (i < 70) return "clear";
  if (i < 90) return "ambiguous";
  return "miss";
}

// ── Mock deps ─────────────────────────────────────────────────────────────────

let currentKind: ReqKind = "clear";

const deps: GateDeps = {
  profileStore: {
    async get(_url: string) {
      if (currentKind === "miss") return null;
      return freshProfile;
    },
    async put() {
      /* no-op */
    },
  },
  policyStore: {
    async get(_policyId: string, _advertiserId: string) {
      return benchPolicy;
    },
  },
  auditStore: {
    async put() {
      /* no-op */
    },
    async query() {
      return { rows: [], nextCursor: null };
    },
    async get() {
      return null;
    },
  },
  profileQueue: {
    async enqueue() {
      /* no-op */
    },
  },
  llmClient: {
    async chat() {
      // Simulate Flash latency: 200ms base + up to 100ms jitter
      const delay = 200 + Math.random() * 100;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      return {
        content: '{"decision":"ALLOW"}',
        lobstertrapTraceId: "bench-lt-trace",
        verdict: "ALLOW",
        usage: null,
      };
    },
    async healthcheck() {
      return { ok: true as const, lobstertrapVersion: "bench-mock" };
    },
  },
  policyMatcher: {
    match() {
      return currentKind === "ambiguous" ? ambiguousResult : clearResult;
    },
  },
};

// ── Benchmark ─────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

async function run(): Promise<void> {
  const app = createApp(deps);
  await app.ready();

  const latencies: number[] = [];
  const N = 100;

  // Sequential to avoid saturating in-process event loop with concurrent requests
  for (let i = 0; i < N; i++) {
    currentKind = assignKind(i);
    const res = await app.inject({
      method: "POST",
      url: "/verify",
      payload: validBody,
    });
    type VerdictBody = { latencyMs?: number };
    const body = res.json<VerdictBody>();
    if (typeof body.latencyMs === "number") {
      latencies.push(body.latencyMs);
    }
  }

  await app.close();

  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  console.log(`\nBenchmark results (n=${N}):`);
  console.log(`  P50: ${p50}ms`);
  console.log(`  P95: ${p95}ms`);
  console.log(`  P99: ${p99}ms`);

  const pass = p50 < 250 && p95 < 600 && p99 < 1000;

  if (pass) {
    console.log("\n✅ PASS: Node+Fastify within SLA budget.");
    console.log("   Decision: Node+Fastify confirmed for hot path.");
  } else {
    console.log("\n❌ FAIL: Node+Fastify P99 exceeds budget.");
    console.log(
      "   FAIL: Node+Fastify P99 exceeds budget. Document in PLANNING.md and" +
        " evaluate Bun+Hono. Foundation Q2 decision required before demo.",
    );
    process.exit(1);
  }
}

await run();
