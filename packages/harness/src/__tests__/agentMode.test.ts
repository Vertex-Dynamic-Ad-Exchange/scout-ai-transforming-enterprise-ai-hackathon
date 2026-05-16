import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserUse } from "browser-use-sdk";
import { HarnessError, HarnessException } from "@scout/shared";
import type { HarnessConfig } from "../config.js";
import { AGENT_OUTPUT_JSON_SCHEMA, AGENT_TASK_PROMPT, captureViaAgent } from "../agentMode.js";

// PRP-C1: the agentMode tests construct a structurally-typed sdk fake and pass
// it directly to captureViaAgent. We avoid vi.mock("browser-use-sdk") here
// because the function takes `sdk: BrowserUse` as an arg — the factory wires
// the real constructor; this file exercises the orchestrator in isolation.
//
// PRP D1 (literal): sessions.create + tasks.create. structuredOutput is the
// stringified JSON Schema the vendor LLM constrains its output to. We mock
// sdk.tasks.wait(taskId, opts) instead of the original PRP draft's
// `tasks.create({ schema }).complete()` path — that path doesn't exist in the
// SDK and would also pull in a zod-version mismatch (R1 in the PRP confidence
// section, surfaced during impl).
const mocks = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionStop: vi.fn(),
  tasksCreate: vi.fn(),
  tasksWait: vi.fn(),
}));

function fakeSdk(): BrowserUse {
  return {
    sessions: { create: mocks.sessionCreate, stop: mocks.sessionStop },
    tasks: { create: mocks.tasksCreate, wait: mocks.tasksWait },
  } as unknown as BrowserUse;
}

const cfg: HarnessConfig = {
  browserUseApiKey: "test-key",
  defaultProxyCountry: "US",
};

function validAgentOutput() {
  return {
    finalUrl: "https://example.test/article",
    pageTitle: "Hello",
    pageHeadline: "Hello",
    visibleText: "hello world dom text",
    metaDescription: null,
    metaOgType: null,
    metaLang: "en",
    // "img0" base64-encoded — non-empty single screenshot satisfies the
    // structured-output schema's minItems:1.
    screenshotBase64: ["aW1nMA=="],
    videoPresent: false,
    videoPosterBase64: null,
  };
}

beforeEach(() => {
  mocks.sessionCreate.mockReset();
  mocks.sessionStop.mockReset().mockResolvedValue({});
  mocks.tasksCreate.mockReset();
  mocks.tasksWait.mockReset();
});

describe("AGENT_TASK_PROMPT — T3c prompt-injection mitigation (module-level)", () => {
  it("contains no template variables other than the url interpolation", () => {
    // SECURITY: any `{name}` literal in the prompt would be a second injection
    // vector — the vendor LLM may render it with attacker-controlled context.
    expect(AGENT_TASK_PROMPT("https://x.test/").match(/\{[a-zA-Z_]+\}/)).toBeNull();
  });

  it("differs only at the URL position across 10 random substitutions", () => {
    const template = AGENT_TASK_PROMPT("<URL>");
    for (let i = 0; i < 10; i += 1) {
      const url = `https://random${i}.test/path?q=${i}`;
      expect(AGENT_TASK_PROMPT(url)).toBe(template.replace("<URL>", url));
    }
  });
});

describe("captureViaAgent — T3a happy path", () => {
  it("returns mode=agent, sessionId, finalUrl; pins tenancy + prompt + JSON Schema + stop", async () => {
    mocks.sessionCreate.mockResolvedValue({ id: "agent-1" });
    mocks.tasksCreate.mockResolvedValue({ id: "task-1" });
    mocks.tasksWait.mockResolvedValue({ output: JSON.stringify(validAgentOutput()) });

    const result = await captureViaAgent(fakeSdk(), cfg, "https://example.test/article", {});

    expect(result.capturedBy.mode).toBe("agent");
    expect(result.capturedBy.sessionId).toBe("agent-1");
    expect(result.capturedBy.sdkVersion).toBe("browser-use-sdk@3.6.0");
    expect(result.screenshots.length).toBeGreaterThanOrEqual(1);
    expect(result.url).toBe("https://example.test/article");
    expect(result.requestedUrl).toBe("https://example.test/article");

    // SECURITY tenancy pins: a regression on either is a cross-advertiser leak.
    const sessionCall = mocks.sessionCreate.mock.calls[0]?.[0];
    expect(sessionCall).toMatchObject({ persistMemory: false, keepAlive: false });

    // Prompt fidelity (exact match) + structuredOutput round-trip
    // (JSON Schema literal we control).
    const taskCall = mocks.tasksCreate.mock.calls[0]?.[0];
    expect(taskCall?.task).toBe(AGENT_TASK_PROMPT("https://example.test/article"));
    expect(taskCall?.sessionId).toBe("agent-1");
    expect(taskCall?.structuredOutput).toBe(JSON.stringify(AGENT_OUTPUT_JSON_SCHEMA));

    // Orphan cleanup — same money-leak surface as Browser mode.
    expect(mocks.sessionStop).toHaveBeenCalledTimes(1);
    expect(mocks.sessionStop).toHaveBeenCalledWith("agent-1");
  });
});

describe("captureViaAgent — T3b failure mapping", () => {
  it("maps a 422-shaped SDK error to HarnessError.UPSTREAM_DOWN and still tears down the session", async () => {
    mocks.sessionCreate.mockResolvedValue({ id: "agent-2" });
    mocks.tasksCreate.mockResolvedValue({ id: "task-2" });
    // mockImplementation (not mockReturnValue): defers Promise.reject construction
    // to call-time so the rejection isn't flagged unhandled before our impl's
    // .then handler attaches.
    mocks.tasksWait.mockImplementation(() =>
      Promise.reject({ status: 422, name: "ValidationError", message: "bad" }),
    );

    let thrown: unknown;
    try {
      await captureViaAgent(fakeSdk(), cfg, "https://example.test/article", {});
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HarnessException);
    expect((thrown as HarnessException).code).toBe(HarnessError.UPSTREAM_DOWN);
    expect(mocks.sessionStop).toHaveBeenCalledWith("agent-2");
  });
});

describe("captureViaAgent — T3d timeout cap", () => {
  // Real timers (mirror packages/harness/src/__tests__/browserMode.abort.test.ts):
  // captureViaAgent does a real mkdtemp before reaching the setTimeout, and
  // vi.useFakeTimers doesn't fake fs.* — sequencing the two reliably is more
  // brittle than just running the 100ms budget in real time.
  it("throws HarnessError.TIMEOUT when the task never resolves within opts.timeoutMs", async () => {
    mocks.sessionCreate.mockResolvedValue({ id: "agent-3" });
    mocks.tasksCreate.mockResolvedValue({ id: "task-3" });
    // Never resolves — simulates a vendor LLM that hangs on the task.
    mocks.tasksWait.mockImplementation(() => new Promise(() => undefined));

    const start = Date.now();
    let thrown: unknown;
    try {
      await captureViaAgent(fakeSdk(), cfg, "https://example.test/", { timeoutMs: 100 });
    } catch (e) {
      thrown = e;
    }
    const elapsed = Date.now() - start;

    expect(thrown).toBeInstanceOf(HarnessException);
    expect((thrown as HarnessException).code).toBe(HarnessError.TIMEOUT);
    // 100ms budget + 100ms slack — catches a regression where the race
    // resolves only AFTER the task completes.
    expect(elapsed).toBeLessThan(200);
    // Session cleanup still happens on the timeout path.
    expect(mocks.sessionStop).toHaveBeenCalledWith("agent-3");
  });
});

describe("captureViaAgent — T3e geo passthrough", () => {
  it("threads opts.geo:'DE' to sessions.create as proxyCountryCode:'de' and preserves UPPER on output", async () => {
    mocks.sessionCreate.mockResolvedValue({ id: "agent-4" });
    mocks.tasksCreate.mockResolvedValue({ id: "task-4" });
    mocks.tasksWait.mockResolvedValue({ output: JSON.stringify(validAgentOutput()) });

    const result = await captureViaAgent(fakeSdk(), cfg, "https://example.test/", {
      geo: "DE",
    });

    expect(result.geo).toBe("DE");
    expect(mocks.sessionCreate.mock.calls[0]?.[0]).toMatchObject({ proxyCountryCode: "de" });
  });
});

describe("captureViaAgent — T3f schema-conformance regression", () => {
  it("throws UPSTREAM_DOWN with a path-only message when AgentOutput is invalid", async () => {
    mocks.sessionCreate.mockResolvedValue({ id: "agent-5" });
    mocks.tasksCreate.mockResolvedValue({ id: "task-5" });
    // Mutate the output to drop finalUrl — schema requires it.
    const broken = { ...validAgentOutput() } as Record<string, unknown>;
    delete broken["finalUrl"];
    mocks.tasksWait.mockResolvedValue({ output: JSON.stringify(broken) });

    let thrown: unknown;
    try {
      await captureViaAgent(fakeSdk(), cfg, "https://example.test/", {});
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HarnessException);
    expect((thrown as HarnessException).code).toBe(HarnessError.UPSTREAM_DOWN);
    expect((thrown as HarnessException).message).toMatch(/^agent output invalid at path: [\w.]+$/);
  });
});
