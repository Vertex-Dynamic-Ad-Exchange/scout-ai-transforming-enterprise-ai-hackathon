import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserUse } from "browser-use-sdk";
import { HarnessError, HarnessException, type PageCapture } from "@scout/shared";
import type { HarnessConfig } from "../config.js";

// PRP-C2 Task 1: capture.ts is the two-pass orchestrator. We mock both mode
// drivers as separate modules so each T1* test can pin the routing decision
// (which mode ran, in what order, with what result) without invoking the real
// browser-use SDK or Playwright. Mocks are hoisted so vi.mock() resolves them
// before capture.ts's static imports.
const mocks = vi.hoisted(() => ({
  captureViaBrowser: vi.fn(),
  captureViaAgent: vi.fn(),
}));

vi.mock("../browserMode.js", () => ({
  capturePage: mocks.captureViaBrowser,
}));

vi.mock("../agentMode.js", () => ({
  captureViaAgent: mocks.captureViaAgent,
}));

import { capturePage } from "../capture.js";

const sdk = {} as BrowserUse;
const cfg: HarnessConfig = {
  browserUseApiKey: "test-key",
  defaultProxyCountry: "US",
};

function fakeCapture(mode: "browser" | "agent", warnings: string[] = []): PageCapture {
  return {
    url: "https://example.test/article",
    requestedUrl: "https://example.test/article",
    contentHash: "a".repeat(64),
    capturedAt: "2026-05-15T00:00:00.000Z",
    geo: "US",
    domText: "hello",
    headline: null,
    metadata: { title: null, description: null, ogType: null, lang: null },
    screenshots: [
      {
        uri: "file:///tmp/x.png",
        kind: "above_fold",
        scrollY: 0,
        viewport: { w: 1280, h: 800 },
        bytes: 1,
      },
    ],
    videoSamples: [],
    capturedBy: { mode, sdkVersion: "browser-use-sdk@3.6.0", sessionId: "s-1" },
    warnings: [...warnings],
  };
}

beforeEach(() => {
  mocks.captureViaBrowser.mockReset();
  mocks.captureViaAgent.mockReset();
});

describe("capturePage — T1a Browser succeeds → no Agent invocation", () => {
  it("returns mode=browser, never calls Agent, no fallback warning", async () => {
    mocks.captureViaBrowser.mockResolvedValue(fakeCapture("browser"));

    const result = await capturePage(sdk, cfg, "https://example.test/article", {});

    expect(result.capturedBy.mode).toBe("browser");
    expect(mocks.captureViaBrowser).toHaveBeenCalledTimes(1);
    expect(mocks.captureViaAgent).toHaveBeenCalledTimes(0);
    expect(result.warnings).not.toContain("consent_wall_handled_via_agent_mode");
  });
});

describe("capturePage — T1b CONSENT_WALL_UNRESOLVED → Agent retried → success", () => {
  it("falls back to Agent and pushes verbatim 'consent_wall_handled_via_agent_mode'", async () => {
    mocks.captureViaBrowser.mockRejectedValue(
      new HarnessException(HarnessError.CONSENT_WALL_UNRESOLVED, "consent wall present"),
    );
    mocks.captureViaAgent.mockResolvedValue(fakeCapture("agent"));

    const result = await capturePage(sdk, cfg, "https://example.test/article", {});

    expect(result.capturedBy.mode).toBe("agent");
    // D2 verbatim string pin — the profiler observes this warning to know which
    // path produced the capture. A rename here breaks the observability seam.
    expect(result.warnings).toContain("consent_wall_handled_via_agent_mode");
    expect(mocks.captureViaBrowser).toHaveBeenCalledTimes(1);
    expect(mocks.captureViaAgent).toHaveBeenCalledTimes(1);
  });
});

describe("capturePage — T1c BLOCKED → Agent retried → success", () => {
  it("falls back to Agent on BLOCKED with the verbatim fallback warning", async () => {
    mocks.captureViaBrowser.mockRejectedValue(
      new HarnessException(HarnessError.BLOCKED, "HTTP 403"),
    );
    mocks.captureViaAgent.mockResolvedValue(fakeCapture("agent"));

    const result = await capturePage(sdk, cfg, "https://example.test/article", {});

    expect(result.capturedBy.mode).toBe("agent");
    expect(result.warnings).toContain("consent_wall_handled_via_agent_mode");
    expect(mocks.captureViaBrowser).toHaveBeenCalledTimes(1);
    expect(mocks.captureViaAgent).toHaveBeenCalledTimes(1);
  });
});

describe("capturePage — T1d TIMEOUT does NOT retry", () => {
  it("re-throws TIMEOUT unchanged and never invokes Agent", async () => {
    mocks.captureViaBrowser.mockRejectedValue(
      new HarnessException(HarnessError.TIMEOUT, "browser create timeout"),
    );

    let thrown: unknown;
    try {
      await capturePage(sdk, cfg, "https://example.test/article", {});
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(HarnessException);
    expect((thrown as HarnessException).code).toBe(HarnessError.TIMEOUT);
    // Retrying via Agent on TIMEOUT would compound latency cost — fail-closed pin.
    expect(mocks.captureViaAgent).toHaveBeenCalledTimes(0);
  });
});

describe("capturePage — T1e NAVIGATION_FAILED does NOT retry", () => {
  it("re-throws NAVIGATION_FAILED unchanged and never invokes Agent", async () => {
    mocks.captureViaBrowser.mockRejectedValue(
      new HarnessException(HarnessError.NAVIGATION_FAILED, "unsupported content-type"),
    );

    let thrown: unknown;
    try {
      await capturePage(sdk, cfg, "https://example.test/article", {});
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(HarnessException);
    expect((thrown as HarnessException).code).toBe(HarnessError.NAVIGATION_FAILED);
    expect(mocks.captureViaAgent).toHaveBeenCalledTimes(0);
  });
});

describe("capturePage — T1f both modes fail", () => {
  it("throws the Agent-mode error code; Browser-mode error is not exposed to caller", async () => {
    mocks.captureViaBrowser.mockRejectedValue(
      new HarnessException(HarnessError.CONSENT_WALL_UNRESOLVED, "browser-side msg"),
    );
    mocks.captureViaAgent.mockRejectedValue(
      new HarnessException(HarnessError.UPSTREAM_DOWN, "agent-side msg"),
    );

    let thrown: unknown;
    try {
      await capturePage(sdk, cfg, "https://example.test/article", {});
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(HarnessException);
    // D4: the second attempt's outcome wins. The Browser-mode error is lost
    // to the caller (could be debug-logged in future; not required here).
    expect((thrown as HarnessException).code).toBe(HarnessError.UPSTREAM_DOWN);
    expect((thrown as HarnessException).message).toBe("agent-side msg");
    expect((thrown as HarnessException).message).not.toContain("browser-side");
  });
});

describe("capturePage — T1g forceAgentMode:true", () => {
  it("Browser is never invoked; Agent runs; no fallback warning (forced ≠ fallback)", async () => {
    mocks.captureViaAgent.mockResolvedValue(fakeCapture("agent"));

    const result = await capturePage(sdk, cfg, "https://example.test/article", {
      forceAgentMode: true,
    });

    expect(mocks.captureViaBrowser).toHaveBeenCalledTimes(0);
    expect(mocks.captureViaAgent).toHaveBeenCalledTimes(1);
    expect(result.capturedBy.mode).toBe("agent");
    // D3: forceAgentMode is a direct path, not a fallback — no warning.
    expect(result.warnings).not.toContain("consent_wall_handled_via_agent_mode");
  });
});

describe("capturePage — options validation (single parse pinned here)", () => {
  it("rejects unknown options at the orchestrator boundary (CaptureOptionsSchema is .strict())", async () => {
    let thrown: unknown;
    try {
      // @ts-expect-error — intentionally bad shape; pins .strict() enforcement
      await capturePage(sdk, cfg, "https://example.test/", { geoLocation: "DE" });
    } catch (e) {
      thrown = e;
    }
    // Either modes get invoked is a routing regression — the parse should
    // throw before any mode driver is touched.
    expect(thrown).toBeDefined();
    expect(mocks.captureViaBrowser).toHaveBeenCalledTimes(0);
    expect(mocks.captureViaAgent).toHaveBeenCalledTimes(0);
  });
});
