import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VerificationVerdict } from "@scout/shared";
import { LlmChatError } from "@scout/llm-client";
import { createApp } from "./index.js";
import {
  validBody,
  validProfile,
  ambiguousResult,
  humanReviewResult,
  buildDeps,
} from "./handler.test-helpers.js";

function chatMockRespectingAbort(
  onAbort?: (traceId: string) => void,
): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((args: { signal?: AbortSignal }) => {
    return new Promise((_resolve, reject) => {
      const signal = args.signal;
      if (!signal) {
        return;
      }
      const rejectAbort = (): void => {
        const traceId = "lt-abort-trace";
        onAbort?.(traceId);
        reject(new LlmChatError("The operation was aborted", traceId, new DOMException("aborted", "AbortError")));
      };
      if (signal.aborted) {
        rejectAbort();
        return;
      }
      signal.addEventListener("abort", rejectAbort, { once: true });
    });
  });
}

describe("POST /verify — edge cases and failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("7: prior arbiter dom_snippet evidence → HUMAN_REVIEW with arbiter_disagreement", async () => {
    const profileWithDisagreement = {
      ...validProfile,
      evidenceRefs: [{ kind: "dom_snippet" as const, uri: "https://example.com/snippet" }],
    };
    const deps = buildDeps({
      profileStore: { get: vi.fn().mockResolvedValue(profileWithDisagreement), put: vi.fn() },
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
    expect(deps.policyStore.get).not.toHaveBeenCalled();
    expect(deps.llmClient.chat).not.toHaveBeenCalled();
  });

  it("8: policy escalation HUMAN_REVIEW match → 200 HUMAN_REVIEW, no Flash call", async () => {
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

  it("9: Flash never resolves within 400ms → DENY, ref:flash_timeout, non-null traceId", async () => {
    vi.useFakeTimers();
    const deps = buildDeps({
      policyMatcher: { match: vi.fn().mockReturnValue(ambiguousResult) },
      llmClient: {
        chat: chatMockRespectingAbort(),
        healthcheck: vi.fn(),
      },
    });
    const injectPromise = createApp(deps).inject({
      method: "POST",
      url: "/verify",
      payload: validBody,
    });
    await vi.advanceTimersByTimeAsync(400);
    const res = await injectPromise;
    const body = res.json<VerificationVerdict>();
    expect(res.statusCode).toBe(200);
    expect(body.decision).toBe("DENY");
    expect(body.reasons[0]?.kind).toBe("fail_closed");
    expect(body.reasons[0]?.ref).toBe("flash_timeout");
    expect(body.lobstertrapTraceId).not.toBeNull();
    expect(deps.llmClient.chat).toHaveBeenCalledTimes(1);
    const signal = deps.llmClient.chat.mock.calls[0]?.[0]?.signal;
    expect(signal?.aborted).toBe(true);
  });

  it("10: LT verdict=DENY overrides model ALLOW → DENY, ref:lobstertrap_denied, traceId recorded", async () => {
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

  it("11: tenant_mismatch → 200 DENY, ref:tenant_mismatch", async () => {
    const deps = buildDeps({
      policyStore: { get: vi.fn().mockResolvedValue(null) },
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
    expect(body.reasons[0]?.ref).toBe("tenant_mismatch");
    expect(deps.llmClient.chat).not.toHaveBeenCalled();
  });

  it("12: malformed body → 400, no auditStore.put, no profileQueue.enqueue", async () => {
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

  it("13: policyStore.get throws → 500 DENY, ref:handler_exception, audit fired", async () => {
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

describe("ambiguous-path invariant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("every ambiguous-path verdict has non-null lobstertrapTraceId", async () => {
    const scenarios = [
      {
        label: "Flash ALLOW",
        llmClient: {
          chat: vi.fn().mockResolvedValue({
            content: '{"decision":"ALLOW"}',
            lobstertrapTraceId: "lt-allow",
            verdict: "ALLOW",
            usage: null,
          }),
          healthcheck: vi.fn(),
        },
      },
      {
        label: "Flash DENY",
        llmClient: {
          chat: vi.fn().mockResolvedValue({
            content: '{"decision":"DENY"}',
            lobstertrapTraceId: "lt-deny-model",
            verdict: "ALLOW",
            usage: null,
          }),
          healthcheck: vi.fn(),
        },
      },
      {
        label: "flash_timeout",
        llmClient: {
          chat: chatMockRespectingAbort(),
          healthcheck: vi.fn(),
        },
        useFakeTimers: true,
      },
    ] as const;

    for (const scenario of scenarios) {
      if (scenario.useFakeTimers) {
        vi.useFakeTimers();
      }
      const deps = buildDeps({
        policyMatcher: { match: vi.fn().mockReturnValue(ambiguousResult) },
        llmClient: scenario.llmClient,
      });
      const injectPromise = createApp(deps).inject({
        method: "POST",
        url: "/verify",
        payload: validBody,
      });
      if (scenario.useFakeTimers) {
        await vi.advanceTimersByTimeAsync(400);
      }
      const res = await injectPromise;
      const body = res.json<VerificationVerdict>();
      expect(body.lobstertrapTraceId, scenario.label).not.toBeNull();
      if (scenario.useFakeTimers) {
        vi.useRealTimers();
      }
    }
  });
});
