import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type {
  AuditRow,
  AuditRowVerdict,
  Category,
  Decision,
  EvidenceRef,
  PageProfile,
  Reason,
} from "@scout/shared";

vi.mock("../api/client.js", () => ({
  getVerdict: vi.fn(),
  listVerdicts: vi.fn(),
  fetchVerdicts: vi.fn(),
  evidenceUrl: vi.fn(),
}));

import { getVerdict } from "../api/client.js";
import {
  ReasonsDrilldown,
  __resetReasonsDrilldownWarnings,
} from "./ReasonsDrilldown.js";
import {
  __resetSelectedVerdictId,
  setSelectedVerdictId,
} from "./state/selectedVerdict.js";
import type { Disagreement } from "./components/DisagreementsPanel.js";

const getMock = vi.mocked(getVerdict);

function wrapper(qc: QueryClient): (props: { children: ReactNode }) => ReactNode {
  return ({ children }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

function newQC(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

function category(label: string, confidence: number): Category {
  return { label, confidence };
}

function ev(i: number, kind: EvidenceRef["kind"] = "screenshot"): EvidenceRef {
  return { kind, uri: `s3://bucket/${kind}-${i}.bin` };
}

function profile(over: Partial<PageProfile> = {}): PageProfile {
  return {
    id: "prof-1",
    url: "https://example.com/x",
    contentHash: "h",
    categories: [],
    detectedEntities: [],
    evidenceRefs: [],
    capturedAt: "2026-05-17T12:00:00.000Z",
    ttl: 60,
    ...over,
  };
}

interface RowOpts {
  decision?: Decision;
  reasons?: Reason[];
  profile?: PageProfile | null;
  disagreements?: Disagreement[];
  pageUrl?: string;
  creativeRef?: string;
  geo?: string;
}

function verdictRow(id: string, opts: RowOpts = {}): AuditRowVerdict {
  const base: AuditRowVerdict = {
    kind: "verdict",
    id,
    advertiserId: "demo-advertiser",
    ts: "2026-05-17T12:00:00.000Z",
    request: {
      advertiserId: "demo-advertiser",
      policyId: "p1",
      pageUrl: opts.pageUrl ?? "https://example.com/x",
      creativeRef: opts.creativeRef ?? "c-abc",
      geo: opts.geo ?? "US",
      ts: "2026-05-17T12:00:00.000Z",
    },
    verdict: {
      decision: opts.decision ?? "ALLOW",
      reasons: opts.reasons ?? [],
      profileId: "prof-1",
      policyVersion: "policy-v1",
      latencyMs: 47,
      lobstertrapTraceId: "lt-1",
    },
    profile: opts.profile === undefined ? null : opts.profile,
    declaredIntent: null,
    detectedIntent: null,
  };
  if (opts.disagreements !== undefined) {
    // Forward-compat slot for arbiter `disagreements[]` — the
    // `VerificationVerdict` schema doesn't carry the field yet; the
    // Drilldown reads it defensively (PRP 06 confidence note).
    (base.verdict as unknown as { disagreements: Disagreement[] }).disagreements =
      opts.disagreements;
  }
  return base;
}

function renderWith(qc: QueryClient): void {
  render(createElement(ReasonsDrilldown), { wrapper: wrapper(qc) });
}

describe("<ReasonsDrilldown /> — no selection", () => {
  beforeEach(() => {
    __resetSelectedVerdictId();
    __resetReasonsDrilldownWarnings();
    getMock.mockReset();
  });

  it("returns null when selectedVerdictId is null — DOM stays empty (PRP 06 Task 11a)", () => {
    const qc = newQC();
    const { container } = render(createElement(ReasonsDrilldown), {
      wrapper: wrapper(qc),
    });
    expect(container).toBeEmptyDOMElement();
    expect(getMock).not.toHaveBeenCalled();
    qc.clear();
  });
});

describe("<ReasonsDrilldown /> — reason grouping (Task 7)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    __resetSelectedVerdictId();
    __resetReasonsDrilldownWarnings();
    getMock.mockReset();
    qc = newQC();
  });

  afterEach(() => {
    qc.clear();
  });

  it("renders one group per known Reason.kind with the right count", async () => {
    const reasons: Reason[] = [
      { kind: "profile_signal", ref: "cat:x", detail: "x" },
      { kind: "profile_signal", ref: "cat:y", detail: "y" },
      { kind: "policy_rule", ref: "rule-1", detail: "fires" },
      { kind: "arbiter_disagreement", ref: "disagree-1", detail: "drift" },
      { kind: "fail_closed", ref: "timeout", detail: "deadline" },
    ];
    getMock.mockResolvedValueOnce(verdictRow("v1", { reasons }));
    act(() => setSelectedVerdictId("v1"));

    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("drilldown")).toBeInTheDocument();
    });
    expect(screen.getByTestId("reason-group-count-profile_signal")).toHaveTextContent(
      "2",
    );
    expect(screen.getByTestId("reason-group-count-policy_rule")).toHaveTextContent("1");
    expect(
      screen.getByTestId("reason-group-count-arbiter_disagreement"),
    ).toHaveTextContent("1");
    expect(screen.getByTestId("reason-group-count-fail_closed")).toHaveTextContent("1");
  });
});

describe("<ReasonsDrilldown /> — profile + bid context (Task 8)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    __resetSelectedVerdictId();
    __resetReasonsDrilldownWarnings();
    getMock.mockReset();
    qc = newQC();
  });

  afterEach(() => {
    qc.clear();
  });

  it("renders ProfileSnapshot when profile is non-null, with sorted categories + 12-tile grid", async () => {
    const cats = [
      category("low", 0.1),
      category("high", 0.9),
      category("mid", 0.5),
    ];
    const evidence = Array.from({ length: 12 }, (_, i) => ev(i));
    getMock.mockResolvedValueOnce(
      verdictRow("v1", {
        profile: profile({ categories: cats, evidenceRefs: evidence }),
      }),
    );
    act(() => setSelectedVerdictId("v1"));

    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("profile-snapshot")).toBeInTheDocument();
    });
    const order = Array.from(
      document.querySelectorAll<HTMLElement>("[data-testid^='profile-category-']"),
    ).map((el) =>
      el.getAttribute("data-testid")!.replace("profile-category-", ""),
    );
    expect(order).toEqual(["high", "mid", "low"]);
    expect(screen.getAllByTestId("evidence-tile")).toHaveLength(12);
  });

  it("hides ProfileSnapshot entirely when profile === null (D10) — reasons still render", async () => {
    getMock.mockResolvedValueOnce(
      verdictRow("v1", {
        profile: null,
        reasons: [{ kind: "fail_closed", ref: "t", detail: "timeout" }],
      }),
    );
    act(() => setSelectedVerdictId("v1"));

    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("drilldown")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("profile-snapshot")).not.toBeInTheDocument();
    expect(screen.getByTestId("reason-group-fail_closed")).toBeInTheDocument();
  });

  it("BidContext surfaces pageUrl, creativeRef, geo from the request", async () => {
    getMock.mockResolvedValueOnce(
      verdictRow("v1", {
        pageUrl: "https://demo.test/landing/x",
        creativeRef: "creative-42",
        geo: "DE",
      }),
    );
    act(() => setSelectedVerdictId("v1"));

    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("bid-context")).toBeInTheDocument();
    });
    expect(screen.getByTestId("bid-page-url")).toHaveTextContent(
      "https://demo.test/landing/x",
    );
    expect(screen.getByTestId("bid-creative-ref")).toHaveTextContent("creative-42");
    expect(screen.getByTestId("bid-geo")).toHaveTextContent("DE");
  });
});

describe("<ReasonsDrilldown /> — unknown kind forward-compat (Task 9)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    __resetSelectedVerdictId();
    __resetReasonsDrilldownWarnings();
    getMock.mockReset();
    qc = newQC();
  });

  afterEach(() => {
    qc.clear();
  });

  it("unknown Reason.kind renders in the 'Other' bucket, console.warn fires once, no throw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const reasons = [
      { kind: "future_unknown_kind", ref: "x", detail: "y" } as unknown as Reason,
    ];
    getMock.mockResolvedValue(verdictRow("v1", { reasons }));
    act(() => setSelectedVerdictId("v1"));

    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("reason-group-Other")).toBeInTheDocument();
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown Reason.kind"),
      "future_unknown_kind",
    );

    // Second render with the same unknown kind must NOT warn again —
    // module-scoped Set<string> memoization (D4 refactor).
    const second = newQC();
    getMock.mockResolvedValue(verdictRow("v2", { reasons }));
    act(() => {
      setSelectedVerdictId(null);
      setSelectedVerdictId("v2");
    });
    render(createElement(ReasonsDrilldown), { wrapper: wrapper(second) });
    await waitFor(() => {
      expect(screen.getAllByTestId("reason-group-Other").length).toBeGreaterThan(0);
    });
    expect(warn).toHaveBeenCalledTimes(1);
    second.clear();
    warn.mockRestore();
  });
});

describe("<ReasonsDrilldown /> — HUMAN_REVIEW + disagreements (Task 10)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    __resetSelectedVerdictId();
    __resetReasonsDrilldownWarnings();
    getMock.mockReset();
    qc = newQC();
  });

  afterEach(() => {
    qc.clear();
  });

  it("HUMAN_REVIEW + one disagreement → panel visible with three verifier bars", async () => {
    const disagreement: Disagreement = {
      kind: "decision",
      label: "ALLOW",
      perVerifier: { text: 0.85, image: 0.15, video: 0.55 },
    };
    getMock.mockResolvedValueOnce(
      verdictRow("v1", { decision: "HUMAN_REVIEW", disagreements: [disagreement] }),
    );
    act(() => setSelectedVerdictId("v1"));

    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("disagreements-panel")).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("disagreement-decision-ALLOW-text"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("disagreement-decision-ALLOW-image"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("disagreement-decision-ALLOW-video"),
    ).toBeInTheDocument();
  });

  it("HUMAN_REVIEW + empty disagreements → exact D5 fallback text", async () => {
    getMock.mockResolvedValueOnce(
      verdictRow("v1", { decision: "HUMAN_REVIEW", disagreements: [] }),
    );
    act(() => setSelectedVerdictId("v1"));

    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("disagreements-empty-fallback")).toBeInTheDocument();
    });
    expect(screen.getByTestId("disagreements-empty-fallback")).toHaveTextContent(
      "Confidence below threshold — see profile signals",
    );
  });

  it("decision=ALLOW does NOT render the panel", async () => {
    getMock.mockResolvedValueOnce(verdictRow("v1", { decision: "ALLOW" }));
    act(() => setSelectedVerdictId("v1"));

    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("drilldown")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("disagreements-panel")).not.toBeInTheDocument();
  });
});

describe("<ReasonsDrilldown /> — error state (Task 11b)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    __resetSelectedVerdictId();
    __resetReasonsDrilldownWarnings();
    getMock.mockReset();
    qc = newQC();
  });

  afterEach(() => {
    qc.clear();
  });

  it("backend rejection renders an ErrorBanner and Retry triggers a refetch", async () => {
    getMock.mockRejectedValueOnce(new Error("getVerdict failed: HTTP 500"));
    getMock.mockResolvedValueOnce(verdictRow("v1"));
    act(() => setSelectedVerdictId("v1"));

    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("drilldown-error")).toBeInTheDocument();
    });
    const banner = screen.getByTestId("drilldown-error");
    expect(banner).toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("drilldown")).not.toBeInTheDocument();

    const user = userEvent.setup();
    const retry = within(banner).getByRole("button", { name: /retry/i });
    await user.click(retry);

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledTimes(2);
    });
  });

  it("backend 404 (getVerdict returns null) renders an ErrorBanner (cross-tenant or missing)", async () => {
    getMock.mockResolvedValueOnce(null);
    act(() => setSelectedVerdictId("v1"));

    renderWith(qc);

    await waitFor(() => {
      expect(screen.getByTestId("drilldown-error")).toBeInTheDocument();
    });
  });
});

describe("<ReasonsDrilldown /> — non-verdict AuditRow (DLQ) is silent", () => {
  let qc: QueryClient;

  beforeEach(() => {
    __resetSelectedVerdictId();
    __resetReasonsDrilldownWarnings();
    getMock.mockReset();
    qc = newQC();
  });

  afterEach(() => {
    qc.clear();
  });

  it("kind: 'profile_job_dlq' rows do not render a drilldown — the Timeline's Jobs tab is the owner", async () => {
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

    const { container } = render(createElement(ReasonsDrilldown), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => {
      expect(
        container.querySelector("[data-testid='drilldown-loading']"),
      ).toBeNull();
    });
    // Drilldown root absent (DLQ rows don't drill down here — Timeline's
    // Jobs tab is the owner).
    expect(container.querySelector("[data-testid='drilldown']")).toBeNull();
    expect(getMock).toHaveBeenCalled();
  });
});
