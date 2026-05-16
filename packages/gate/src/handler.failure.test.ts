import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VerificationVerdict } from "@scout/shared";
import { createApp } from "./index.js";
import {
  validBody,
  ambiguousResult,
  humanReviewResult,
  buildDeps,
} from "./handler.test-helpers.js";

describe("POST /verify — edge cases and failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("7: HUMAN_REVIEW match result → 200 HUMAN_REVIEW, no Flash call", async () => {
    const deps = buildDeps({
      policyMatcher: { match: vi.fn().mockReturnValue(humanReviewResult) },
    });
    const res = await createApp(deps).inject({
      method: "POST",
      url: "/verify",
      payload: validBody,
    });
    const body = res.json<VerificationVerdict>();
    expect(res.statusCode).toBe(200);
    expect(body.decision).toBe("HUMAN_REVIEW");
    expect(body.reasons.some((r) => r.kind === "arbiter_disagreement")).toBe(true);
    expect(deps.llmClient.chat).not.toHaveBeenCalled();
  });

  it("8: Flash AbortError (timeout) → 200 DENY, ref:flash_timeout", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const deps = buildDeps({
      policyMatcher: { match: vi.fn().mockReturnValue(ambiguousResult) },
      llmClient: { chat: vi.fn().mockRejectedValue(abortError), healthcheck: vi.fn() },
    });
    const res = await createApp(deps).inject({
      method: "POST",
      url: "/verify",
      payload: validBody,
    });
    const body = res.json<VerificationVerdict>();
    expect(res.statusCode).toBe(200);
    expect(body.decision).toBe("DENY");
    expect(body.reasons[0]?.kind).toBe("fail_closed");
    expect(body.reasons[0]?.ref).toBe("flash_timeout");
  });

  it("9: LT verdict=DENY overrides model ALLOW → DENY, ref:lobstertrap_denied, traceId recorded", async () => {
    const deps = buildDeps({
      policyMatcher: { match: vi.fn().mockReturnValue(ambiguousResult) },
      llmClient: {
        chat: vi.fn().mockResolvedValue({
          content: '{"decision":"ALLOW"}',
          lobstertrapTraceId: "lt-deny",
          verdict: "DENY",
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
    expect(body.lobstertrapTraceId).toBe("lt-deny");
    expect(body.reasons.some((r) => r.ref === "lobstertrap_denied")).toBe(true);
  });

  it("10: malformed body → 400, no auditStore.put, no profileQueue.enqueue", async () => {
    const deps = buildDeps();
    const res = await createApp(deps).inject({
      method: "POST",
      url: "/verify",
      payload: { advertiserId: "" },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(res.statusCode).toBe(400);
    expect(deps.auditStore.put).not.toHaveBeenCalled();
    expect(deps.profileQueue.enqueue).not.toHaveBeenCalled();
  });

  it("11: policyStore.get throws → 500 DENY, ref:handler_exception, audit fired", async () => {
    const deps = buildDeps({
      policyStore: { get: vi.fn().mockRejectedValue(new Error("redis timeout")) },
    });
    const res = await createApp(deps).inject({
      method: "POST",
      url: "/verify",
      payload: validBody,
    });
    const body = res.json<VerificationVerdict>();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(res.statusCode).toBe(500);
    expect(body.decision).toBe("DENY");
    expect(body.reasons[0]?.ref).toBe("handler_exception");
    expect(JSON.stringify(body)).not.toContain("redis timeout");
    expect(deps.auditStore.put).toHaveBeenCalledTimes(1);
  });
});
