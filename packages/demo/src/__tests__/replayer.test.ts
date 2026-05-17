import { afterEach, describe, expect, it } from "vitest";
import type { LlmClient } from "@scout/llm-client";
import { createPolicyMatcher, type PolicyMatcher } from "@scout/policy";
import { createStores } from "@scout/store";
import { createApp } from "@scout/gate";
import type {
  BidVerificationRequest,
  PageProfile,
  Policy,
  VerificationVerdict,
} from "@scout/shared";
import { ReplayerError } from "../errors.js";
import { runScenario } from "../replayer.js";
import { startInProcessGate, type InProcessGateHandle } from "../inProcessGate.js";
import type { Scenario } from "../types.js";

function buildBid(pageUrl: string): BidVerificationRequest {
  return {
    advertiserId: "advertiser-test",
    policyId: "policy-test",
    pageUrl,
    creativeRef: "creative-1",
    geo: "US",
    ts: "2026-05-17T00:00:00Z",
  };
}

function makeScenario(bids: Array<{ delayMs: number; request: BidVerificationRequest }>): Scenario {
  return {
    formatVersion: "1.0",
    name: "test",
    description: "",
    seeds: { profiles: [], policies: [] },
    bids,
    expectations: bids.map(() => ({
      latencyMsMax: 5_000,
      lobstertrapTraceIdNullable: true,
    })),
  };
}

describe("runScenario — Task 4 happy path: 2-bid cache-miss → fail_closed DENY", () => {
  let handle: InProcessGateHandle | undefined;
  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
  });

  it("returns one BidResult per bid with valid timing + decisions", async () => {
    handle = await startInProcessGate();
    const scenario = makeScenario([
      { delayMs: 0, request: buildBid("https://example.com/a") },
      { delayMs: 0, request: buildBid("https://example.com/b") },
    ]);
    const results = await runScenario(scenario, { gateUrl: handle.url });
    expect(results).toHaveLength(2);
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      // Pre-bid path: no profile in store → cache_miss DENY (handler.ts:48-64)
      expect(r.verdict.decision).toBe("DENY");
      expect(r.verdict.reasons[0]?.kind).toBe("fail_closed");
      expect(r.verdict.reasons[0]?.ref).toBe("cache_miss");
      // latencyMs is non-negative integer; verdict.latencyMs is handler-internal.
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
      expect(r.verdict.latencyMs).toBeGreaterThanOrEqual(0);
      // ISO-8601 timestamps
      expect(Number.isNaN(Date.parse(r.sentAt))).toBe(false);
      expect(Number.isNaN(Date.parse(r.receivedAt))).toBe(false);
      // Recording-fidelity assertion (PRP-B D6 + feature line 11):
      // ±50ms between replayer-measured and handler-internal latencies. The
      // replayer's number includes wire time, so the diff should be small
      // (in-process gate, undici keep-alive).
      expect(Math.abs(r.latencyMs - r.verdict.latencyMs)).toBeLessThan(50);
    }
  });
});

describe("runScenario — Task 5 edge: delayMs honored (from scenario start, PRP-A D5)", () => {
  let handle: InProcessGateHandle | undefined;
  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
  });

  it("bids[1].delayMs=50 → sentAt delta ≥ 45ms (5ms jitter slack)", async () => {
    handle = await startInProcessGate();
    const scenario = makeScenario([
      { delayMs: 0, request: buildBid("https://example.com/c") },
      { delayMs: 50, request: buildBid("https://example.com/d") },
    ]);
    const results = await runScenario(scenario, { gateUrl: handle.url });
    const delta = Date.parse(results[1]!.sentAt) - Date.parse(results[0]!.sentAt);
    expect(delta).toBeGreaterThanOrEqual(45);
  });
});

describe("runScenario — Task 6 failure: gate 500 → ReplayerError", () => {
  // PRP-B Task 6 originally proposed triggering 500 via "stub chat() throws";
  // escalate.ts (packages/gate/src/escalate.ts:61-81) catches every chat()
  // error and returns DENY/lobstertrap_unavailable, so that path actually
  // yields 200, not 500. To preserve the SPIRIT of the test (replayer must
  // surface a real gate 500 as ReplayerError) we instead inject a sync-throw
  // into the handler's hot path via a faulty policyMatcher — this throws
  // INSIDE the handler's try block (handler.ts:94) and bubbles to the outer
  // catch (handler.ts:149-152), which is the 500/failClosedVerdict path the
  // original PRP wanted to exercise.
  const profile: PageProfile = {
    id: "profile-test",
    url: "https://example.com/ambiguous",
    contentHash: "hash-1",
    categories: [{ label: "Politics", confidence: 0.42 }],
    detectedEntities: [],
    evidenceRefs: [],
    capturedAt: new Date().toISOString(),
    ttl: 3_600,
  };
  const policy: Policy = {
    id: "policy-test",
    version: "v1",
    advertiserId: "advertiser-test",
    rules: [{ id: "rule-1", kind: "category", match: "Politics", action: "ALLOW" }],
    escalation: { ambiguousAction: "ALLOW", humanReviewThreshold: 0.8 },
  };

  it("ReplayerError thrown, .status===500, .detail is a VerificationVerdict with handler_exception, .bidIndex===0", async () => {
    const stores = createStores({ initialPolicies: [policy] });
    await stores.profileStore.put(profile);
    const stubLlmClient: LlmClient = {
      async chat() {
        throw new Error("stub — must not be called in this test");
      },
      async healthcheck() {
        return { ok: true, lobstertrapVersion: "stub" } as const;
      },
    };
    const throwingMatcher: PolicyMatcher = {
      match() {
        throw new Error("forced policyMatcher throw to trigger handler.ts:149-152");
      },
    };
    const app = createApp({
      ...stores,
      llmClient: stubLlmClient,
      policyMatcher: throwingMatcher,
    });
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const scenario = makeScenario([{ delayMs: 0, request: buildBid(profile.url) }]);
      try {
        await runScenario(scenario, { gateUrl: url });
        expect.unreachable("expected ReplayerError");
      } catch (err) {
        expect(err).toBeInstanceOf(ReplayerError);
        const e = err as ReplayerError;
        expect(e.status).toBe(500);
        expect(e.bidIndex).toBe(0);
        // .detail should be a parseable VerificationVerdict (assembled via
        // failClosedVerdict("handler_exception") in handler.ts:150).
        const verdict = e.detail as VerificationVerdict;
        expect(verdict.decision).toBe("DENY");
        expect(verdict.reasons[0]?.kind).toBe("fail_closed");
        expect(verdict.reasons[0]?.ref).toBe("handler_exception");
      }
    } finally {
      await app.close();
    }
    // Verify real matcher is exercised by the real-matcher path that
    // createPolicyMatcher() returns (sanity check that PolicyMatcher is the
    // injection point).
    expect(typeof createPolicyMatcher().match).toBe("function");
  });
});
