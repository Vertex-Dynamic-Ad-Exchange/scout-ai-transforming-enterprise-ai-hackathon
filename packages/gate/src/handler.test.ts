import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VerificationVerdict } from "@scout/shared";
import { createApp } from "./index.js";
import {
  validBody,
  validProfile,
  clearDenyResult,
  ambiguousResult,
  buildDeps,
} from "./handler.test-helpers.js";

describe("POST /verify — happy paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1: cache-hit + clear policy-ALLOW → 200 ALLOW, no Flash call", async () => {
    const deps = buildDeps();
    const res = await createApp(deps).inject({
      method: "POST",
      url: "/verify",
      payload: validBody,
    });
    const body = res.json<VerificationVerdict>();
    expect(res.statusCode).toBe(200);
    expect(body.decision).toBe("ALLOW");
    expect(body.lobstertrapTraceId).toBeNull();
    expect(body.reasons.some((r) => r.kind === "profile_signal" && r.ref === "news")).toBe(true);
    expect(body.reasons.some((r) => r.kind === "policy_rule" && r.ref === "r1")).toBe(true);
    expect(deps.llmClient.chat).not.toHaveBeenCalled();
  });

  it("2: cache-hit + clear policy-DENY → 200 DENY with policy_rule reason", async () => {
    const deps = buildDeps({ policyMatcher: { match: vi.fn().mockReturnValue(clearDenyResult) } });
    const res = await createApp(deps).inject({
      method: "POST",
      url: "/verify",
      payload: validBody,
    });
    const body = res.json<VerificationVerdict>();
    expect(res.statusCode).toBe(200);
    expect(body.decision).toBe("DENY");
    expect(body.reasons.some((r) => r.kind === "profile_signal" && r.ref === "news")).toBe(true);
    expect(body.reasons.some((r) => r.kind === "policy_rule" && r.ref === "r1")).toBe(true);
    expect(deps.llmClient.chat).not.toHaveBeenCalled();
  });

  it("3: ambiguous + Flash→ALLOW → 200 ALLOW with non-null lobstertrapTraceId", async () => {
    const deps = buildDeps({
      policyMatcher: { match: vi.fn().mockReturnValue(ambiguousResult) },
      llmClient: {
        chat: vi.fn().mockResolvedValue({
          content: '{"decision":"ALLOW"}',
          lobstertrapTraceId: "lt-abc",
          verdict: "ALLOW",
          usage: null,
        }),
        healthcheck: vi.fn(),
      },
    });
    const res = await createApp(deps).inject({
      method: "POST",
      url: "/verify",
      payload: validBody,
    });
    const body = res.json<VerificationVerdict>();
    expect(res.statusCode).toBe(200);
    expect(body.decision).toBe("ALLOW");
    expect(body.lobstertrapTraceId).toBe("lt-abc");
    expect(deps.llmClient.chat).toHaveBeenCalledTimes(1);
  });

  it("4: ambiguous + Flash→DENY → 200 DENY with lobstertrapTraceId recorded", async () => {
    const deps = buildDeps({
      policyMatcher: { match: vi.fn().mockReturnValue(ambiguousResult) },
      llmClient: {
        chat: vi.fn().mockResolvedValue({
          content: '{"decision":"DENY"}',
          lobstertrapTraceId: "lt-xyz",
          verdict: "ALLOW",
          usage: null,
        }),
        healthcheck: vi.fn(),
      },
    });
    const res = await createApp(deps).inject({
      method: "POST",
      url: "/verify",
      payload: validBody,
    });
    const body = res.json<VerificationVerdict>();
    expect(res.statusCode).toBe(200);
    expect(body.decision).toBe("DENY");
    expect(body.lobstertrapTraceId).toBe("lt-xyz");
  });

  it("5: cache-miss → 200 DENY, ref:cache_miss, profileQueue.enqueue called once", async () => {
    const deps = buildDeps({
      profileStore: { get: vi.fn().mockResolvedValue(null), put: vi.fn() },
    });
    const res = await createApp(deps).inject({
      method: "POST",
      url: "/verify",
      payload: validBody,
    });
    const body = res.json<VerificationVerdict>();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(res.statusCode).toBe(200);
    expect(body.decision).toBe("DENY");
    expect(body.reasons[0]?.ref).toBe("cache_miss");
    expect(deps.profileQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.profileQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ url: validBody.pageUrl, advertiserId: validBody.advertiserId }),
    );
  });

  it("6: TTL expired → 200 DENY, ref:cache_miss, enqueue called", async () => {
    const expired = {
      ...validProfile,
      capturedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      ttl: 3600,
    };
    const deps = buildDeps({
      profileStore: { get: vi.fn().mockResolvedValue(expired), put: vi.fn() },
    });
    const res = await createApp(deps).inject({
      method: "POST",
      url: "/verify",
      payload: validBody,
    });
    const body = res.json<VerificationVerdict>();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(res.statusCode).toBe(200);
    expect(body.reasons[0]?.ref).toBe("cache_miss");
    expect(deps.profileQueue.enqueue).toHaveBeenCalledTimes(1);
  });
});
