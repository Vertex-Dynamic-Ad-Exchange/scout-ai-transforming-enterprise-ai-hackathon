import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type {
  AuditRow,
  AuditRowVerdict,
  LobstertrapDeclaredIntent,
  LobstertrapDetectedIntent,
} from "@scout/shared";

vi.mock("../api/client.js", () => ({
  getVerdict: vi.fn(),
  listVerdicts: vi.fn(),
  fetchVerdicts: vi.fn(),
  evidenceUrl: vi.fn(),
}));

import { getVerdict } from "../api/client.js";
import { IntentDiff } from "./IntentDiff.js";
import { __resetSelectedVerdictId, setSelectedVerdictId } from "./state/selectedVerdict.js";
import { DIVERGENCE_HEADING } from "./messages.js";

const getMock = vi.mocked(getVerdict);

function newQC(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function wrapper(qc: QueryClient): (p: { children: ReactNode }) => ReactNode {
  return ({ children }) => createElement(QueryClientProvider, { client: qc }, children);
}

interface RowOpts {
  declaredIntent?: LobstertrapDeclaredIntent | null;
  detectedIntent?: LobstertrapDetectedIntent | null;
  lobstertrapTraceId?: string | null;
}

function row(id: string, opts: RowOpts = {}): AuditRowVerdict {
  return {
    kind: "verdict",
    id,
    advertiserId: "demo-advertiser",
    ts: "2026-05-17T12:00:00.000Z",
    request: {
      advertiserId: "demo-advertiser",
      policyId: "p1",
      pageUrl: "https://example.com/x",
      creativeRef: "c1",
      geo: "US",
      ts: "2026-05-17T12:00:00.000Z",
    },
    verdict: {
      decision: "ALLOW",
      reasons: [],
      profileId: "prof-1",
      policyVersion: "policy-v1",
      latencyMs: 47,
      lobstertrapTraceId:
        opts.lobstertrapTraceId === undefined ? "trace-x" : opts.lobstertrapTraceId,
    },
    profile: null,
    declaredIntent:
      opts.declaredIntent === undefined
        ? {
            declared_intent: "classify page against advertiser policy",
            agent_id: "gate.flash",
          }
        : opts.declaredIntent,
    detectedIntent:
      opts.detectedIntent === undefined
        ? {
            detected_intent: "classify page against advertiser policy",
            divergence: null,
            evidence: null,
          }
        : opts.detectedIntent,
  };
}

function renderWith(qc: QueryClient): void {
  render(createElement(IntentDiff), { wrapper: wrapper(qc) });
}

describe("<IntentDiff /> — no selection", () => {
  beforeEach(() => {
    __resetSelectedVerdictId();
    getMock.mockReset();
  });

  it("returns null when no row is selected (no fetch fires)", () => {
    const qc = newQC();
    const { container } = render(createElement(IntentDiff), {
      wrapper: wrapper(qc),
    });
    expect(container).toBeEmptyDOMElement();
    expect(getMock).not.toHaveBeenCalled();
    qc.clear();
  });
});

describe("<IntentDiff /> — aligned intents (Task 5: happy)", () => {
  let qc: QueryClient;
  beforeEach(() => {
    __resetSelectedVerdictId();
    getMock.mockReset();
    qc = newQC();
  });
  afterEach(() => {
    qc.clear();
  });

  it("renders the green aligned badge and NO amber callout when divergence is null", async () => {
    getMock.mockResolvedValueOnce(row("v1"));
    act(() => setSelectedVerdictId("v1"));
    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("intent-diff")).toBeInTheDocument();
    });
    expect(screen.getByTestId("divergence-aligned")).toBeInTheDocument();
    expect(screen.queryByTestId("divergence-callout-amber")).not.toBeInTheDocument();
    // Both declared + detected columns render.
    expect(screen.getByTestId("intent-declared")).toBeInTheDocument();
    expect(screen.getByTestId("intent-detected")).toBeInTheDocument();
  });
});

describe("<IntentDiff /> — showpiece divergence (Task 6 — Veea moment)", () => {
  let qc: QueryClient;
  beforeEach(() => {
    __resetSelectedVerdictId();
    getMock.mockReset();
    qc = newQC();
  });
  afterEach(() => {
    qc.clear();
  });

  it("renders the amber callout AND the pinned heading when divergence is non-empty", async () => {
    getMock.mockResolvedValueOnce(
      row("v1", {
        detectedIntent: {
          detected_intent: "scope expanded to instruction override",
          divergence:
            "Detected scope expanded beyond declared classification — image verifier prompt may have been jailbroken by overlay text",
          evidence: null,
        },
      }),
    );
    act(() => setSelectedVerdictId("v1"));
    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("divergence-callout-amber")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("heading", { name: new RegExp(DIVERGENCE_HEADING, "i") }),
    ).toBeInTheDocument();
    // Aligned badge is NOT present when divergence fires.
    expect(screen.queryByTestId("divergence-aligned")).not.toBeInTheDocument();
  });
});

describe("<IntentDiff /> — edges + failure (Task 7)", () => {
  let qc: QueryClient;
  beforeEach(() => {
    __resetSelectedVerdictId();
    getMock.mockReset();
    qc = newQC();
  });
  afterEach(() => {
    qc.clear();
  });

  it("edge — lobstertrapTraceId === null → renders nothing (no LLM call on this verdict, no diff to show)", async () => {
    getMock.mockResolvedValueOnce(row("v1", { lobstertrapTraceId: null }));
    act(() => setSelectedVerdictId("v1"));

    const { container } = render(createElement(IntentDiff), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => {
      expect(getMock).toHaveBeenCalled();
    });
    // Resolve any pending React-Query state-flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-testid='intent-diff']")).toBeNull();
  });

  it("edge — declaredIntent === null → renders the empty-state panel (Policy.declaredIntent schema follow-up not yet landed)", async () => {
    getMock.mockResolvedValueOnce(row("v1", { declaredIntent: null }));
    act(() => setSelectedVerdictId("v1"));
    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("intent-diff-empty-declared")).toBeInTheDocument();
    });
    // Diff section itself is NOT rendered — the empty-state stands alone
    // so a judge isn't shown a half-empty two-column layout.
    expect(screen.queryByTestId("intent-declared")).not.toBeInTheDocument();
  });

  it("failure — backend rejection (500) renders the error banner with a Retry button", async () => {
    getMock.mockRejectedValueOnce(new Error("getVerdict failed: HTTP 500"));
    act(() => setSelectedVerdictId("v1"));
    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("intent-diff-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("intent-diff-error")).toHaveAttribute("role", "alert");
  });
});

describe("<IntentDiff /> — DLQ rows (non-verdict AuditRow)", () => {
  let qc: QueryClient;
  beforeEach(() => {
    __resetSelectedVerdictId();
    getMock.mockReset();
    qc = newQC();
  });
  afterEach(() => {
    qc.clear();
  });

  it("kind: 'profile_job_dlq' rows do not render an intent diff", async () => {
    const dlqRow: AuditRow = {
      kind: "profile_job_dlq",
      id: "j1",
      advertiserId: "demo-advertiser",
      ts: "2026-05-17T12:00:00.000Z",
      jobId: "job-1",
      pageUrl: "https://example.com/x",
      attempts: 3,
      nackReason: "fetch_timeout",
    };
    getMock.mockResolvedValueOnce(dlqRow);
    act(() => setSelectedVerdictId("j1"));

    const { container } = render(createElement(IntentDiff), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => {
      expect(getMock).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector("[data-testid='intent-diff']")).toBeNull();
  });
});
