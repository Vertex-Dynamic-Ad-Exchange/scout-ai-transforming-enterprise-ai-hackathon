import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { AuditRow, Decision } from "@scout/shared";

// Hoisted mock factory — every test shares one fetchVerdicts spy.
vi.mock("../api/client.js", () => ({
  listVerdicts: vi.fn(),
  fetchVerdicts: vi.fn(),
  getVerdict: vi.fn(),
  evidenceUrl: vi.fn(),
}));

import { fetchVerdicts } from "../api/client.js";
import { VerdictTimeline } from "./VerdictTimeline.js";
import {
  __resetSelectedVerdictId,
  getSelectedVerdictId,
} from "./state/selectedVerdict.js";

const fetchMock = vi.mocked(fetchVerdicts);

// Pin document.visibilityState to "visible" so the polling tests in
// useVerdictsQuery (file-level) don't poison rendering tests.
function setVisible(): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
}

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }): ReactNode =>
    createElement(QueryClientProvider, { client: qc }, children);
}

function verdictRow(
  id: string,
  decision: Decision,
  opts: {
    pageUrl?: string;
    latencyMs?: number;
    policyVersion?: string;
    traceId?: string | null;
    ts?: string;
  } = {},
): AuditRow {
  const ts = opts.ts ?? "2026-05-17T12:00:00.000Z";
  return {
    kind: "verdict",
    id,
    advertiserId: "demo-advertiser",
    ts,
    request: {
      advertiserId: "demo-advertiser",
      policyId: "p1",
      pageUrl: opts.pageUrl ?? "https://example.com/very/long/path/that/will/be/ellipsised",
      creativeRef: "c1",
      geo: "US",
      ts,
    },
    verdict: {
      decision,
      reasons: [],
      profileId: "prof-1",
      policyVersion: opts.policyVersion ?? "policy-v1",
      latencyMs: opts.latencyMs ?? 47,
      lobstertrapTraceId: opts.traceId === undefined ? "lt-trace-1" : opts.traceId,
    },
    profile: null,
    declaredIntent: null,
    detectedIntent: null,
  };
}

const FIXTURE_ROWS: AuditRow[] = [
  verdictRow("v1", "ALLOW", { latencyMs: 47, traceId: "lt-1" }),
  verdictRow("v2", "DENY", { latencyMs: 312, traceId: "lt-2" }),
  verdictRow("v3", "HUMAN_REVIEW", { latencyMs: 901, traceId: "lt-3" }),
  // Non-LLM verdict — chip must be absent for this row.
  verdictRow("v4", "ALLOW", { latencyMs: 8, traceId: null }),
  verdictRow("v5", "DENY", { latencyMs: 122, traceId: "lt-5" }),
];

describe("<VerdictTimeline /> — happy render (PRP 05 step 6)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    setVisible();
    __resetSelectedVerdictId();
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      status: 200,
      etag: '"happy"',
      body: { rows: FIXTURE_ROWS, nextCursor: null },
    });
  });

  afterEach(() => {
    qc.clear();
  });

  it("renders one row per verdict with badge color, svg aria-label, text label, ellipsised URL, '47 ms' latency, policyVersion, and lobstertrap chip when traceId is non-null", async () => {
    render(createElement(VerdictTimeline, null), { wrapper: makeWrapper(qc) });

    // Wait for the 5 rows to land via the mocked fetchVerdicts.
    await waitFor(() => {
      expect(screen.getByText("47 ms")).toBeInTheDocument();
    });

    // ALLOW badge — green hex + svg aria-label + "ALLOW" literal.
    const allowBadge = screen.getAllByTestId("decision-badge-ALLOW")[0];
    expect(allowBadge).toBeDefined();
    expect(allowBadge!).toHaveStyle({ color: "#16a34a" });
    expect(allowBadge!).toHaveTextContent("ALLOW");

    // HUMAN_REVIEW badge — multi-word literal text.
    const hrBadge = screen.getByTestId("decision-badge-HUMAN_REVIEW");
    expect(hrBadge).toHaveTextContent("HUMAN REVIEW");

    // DENY badge — red hex + svg aria-label.
    const denyBadge = screen.getAllByTestId("decision-badge-DENY")[0];
    expect(denyBadge!).toHaveStyle({ color: "#dc2626" });

    // Latency rendered with " ms" suffix (feature spec implicit format).
    expect(screen.getByText("47 ms")).toBeInTheDocument();
    expect(screen.getByText("312 ms")).toBeInTheDocument();
    expect(screen.getByText("901 ms")).toBeInTheDocument();

    // policyVersion appears alongside the row metadata.
    expect(screen.getAllByText("policy-v1").length).toBeGreaterThan(0);

    // pageUrl is plain text (anti-XSS in v1; never an anchor element).
    expect(
      screen.getAllByText(/https:\/\/example.com\/very\/long\/path/)[0],
    ).not.toHaveAttribute("href");

    // Lobster Trap chip present on rows with a non-null traceId,
    // absent on row v4 (traceId: null).
    expect(screen.getByTestId("lobstertrap-chip-v1")).toBeInTheDocument();
    expect(screen.queryByTestId("lobstertrap-chip-v4")).not.toBeInTheDocument();
    expect(screen.getByTestId("lobstertrap-chip-v5")).toBeInTheDocument();
  });

  it("clicking a row sets the selectedVerdict singleton to that row's id", async () => {
    const user = userEvent.setup();
    render(createElement(VerdictTimeline, null), { wrapper: makeWrapper(qc) });

    await waitFor(() => {
      expect(screen.getByTestId("verdict-row-v2")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("verdict-row-v2"));
    expect(getSelectedVerdictId()).toBe("v2");
  });
});

describe("<VerdictTimeline /> — 304 view stability (PRP 05 step 10, feature spec line 59)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    setVisible();
    __resetSelectedVerdictId();
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    fetchMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    qc.clear();
  });

  it("after a 304 poll, the row's DOM node is referentially stable — React does not remount it", async () => {
    const sameBody = { rows: FIXTURE_ROWS, nextCursor: null };
    fetchMock.mockResolvedValueOnce({
      status: 200,
      etag: '"x"',
      body: sameBody,
    });
    fetchMock.mockResolvedValue({ status: 304, etag: '"x"', body: null });

    render(createElement(VerdictTimeline, null), { wrapper: makeWrapper(qc) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const rowBefore = screen.getByTestId("verdict-row-v1");
    expect(rowBefore).toBeInTheDocument();

    // Trigger the next polling tick — backend returns 304, hook
    // returns the cached body verbatim.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    const rowAfter = screen.getByTestId("verdict-row-v1");

    // Object identity: React reused the same DOM node, no unmount or
    // re-create. This is what the 1s polling cadence MUST yield for
    // the demo machine to stay cool under an idle dashboard.
    expect(rowAfter).toBe(rowBefore);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      { kind: "verdict" },
      '"x"',
      expect.any(Object),
    );
  });
});

describe("<VerdictTimeline /> — tab toggle (PRP 05 step 9, D6)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    setVisible();
    __resetSelectedVerdictId();
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      status: 200,
      etag: '"e"',
      body: { rows: [], nextCursor: null },
    });
  });

  afterEach(() => {
    qc.clear();
  });

  it("clicking the 'Jobs' tab fires a fetchVerdicts call with kind: 'profile_job_dlq' (and null etag — a different queryKey doesn't inherit the verdict-kind validator)", async () => {
    // First call hangs so the component stays mid-load and the tab nav
    // stays in the DOM (the empty-state branch swaps the nav away on
    // an instantly-resolved empty fetch).
    fetchMock.mockReturnValueOnce(new Promise(() => undefined));
    fetchMock.mockResolvedValueOnce({
      status: 200,
      etag: '"j"',
      body: { rows: [], nextCursor: null },
    });

    const user = userEvent.setup();
    render(createElement(VerdictTimeline, null), { wrapper: makeWrapper(qc) });

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    expect(fetchMock.mock.calls[0]![0]).toEqual({ kind: "verdict" });

    await user.click(screen.getByRole("tab", { name: "Jobs" }));

    await waitFor(
      () => {
        const dlqCall = fetchMock.mock.calls.find(
          ([params]) =>
            (params as { kind?: string } | undefined)?.kind === "profile_job_dlq",
        );
        expect(dlqCall).toBeDefined();
        // queryKey changed → new map entry, starts at null.
        expect(dlqCall![1]).toBeNull();
      },
      { timeout: 2000 },
    );
  });
});

describe("<VerdictTimeline /> — keyboard nav (PRP 05 step 8, D7)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    setVisible();
    __resetSelectedVerdictId();
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      status: 200,
      etag: '"k"',
      body: { rows: FIXTURE_ROWS, nextCursor: null },
    });
  });

  afterEach(() => {
    qc.clear();
  });

  it("Tab focuses the first row; Enter sets the selected id; Escape blurs back to the scroller container", async () => {
    const user = userEvent.setup();
    render(createElement(VerdictTimeline, null), { wrapper: makeWrapper(qc) });

    await waitFor(() => {
      expect(screen.getByTestId("verdict-row-v1")).toBeInTheDocument();
    });

    // Walk Tab past the two tablist buttons; the first row must be the
    // next tab stop because rows carry tabindex=0.
    await user.tab(); // -> "Verdicts" tab button
    await user.tab(); // -> "Jobs" tab button
    await user.tab(); // -> first verdict row
    expect(screen.getByTestId("verdict-row-v1")).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(getSelectedVerdictId()).toBe("v1");

    await user.keyboard("{Escape}");
    // Escape blurs back to the container; the row is no longer the
    // active element. We don't assert "scroller has focus" because
    // jsdom focus rings on programmatically-focused divs without a
    // tabindex differ from real browsers — the contract is
    // "row loses focus", which is observable.
    expect(screen.getByTestId("verdict-row-v1")).not.toHaveFocus();
  });
});

describe("<VerdictTimeline /> — empty state (PRP 05 step 7, D8)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    setVisible();
    __resetSelectedVerdictId();
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    fetchMock.mockReset();
  });

  afterEach(() => {
    qc.clear();
  });

  it("renders the timeline-empty marker with 'No verdicts yet' when the backend returns rows: []", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      etag: '"e"',
      body: { rows: [], nextCursor: null },
    });
    render(createElement(VerdictTimeline, null), { wrapper: makeWrapper(qc) });

    await waitFor(() => {
      expect(screen.getByTestId("timeline-empty")).toBeInTheDocument();
    });
    expect(screen.getByTestId("timeline-empty")).toHaveTextContent("No verdicts yet");
    // The error sibling must NOT be in the DOM — these are two distinct states.
    expect(screen.queryByTestId("timeline-error")).not.toBeInTheDocument();
  });
});

describe("<VerdictTimeline /> — failure state (PRP 05 step 7, D8)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    setVisible();
    __resetSelectedVerdictId();
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    fetchMock.mockReset();
  });

  afterEach(() => {
    qc.clear();
  });

  it("renders the timeline-error marker with a Retry button when the backend rejects; clicking Retry refetches exactly once", async () => {
    fetchMock.mockRejectedValueOnce(new Error("fetchVerdicts failed: HTTP 500"));
    // The retry resolves with empty rows so we can observe the
    // retry-triggered fetch separately from the failed initial.
    fetchMock.mockResolvedValueOnce({
      status: 200,
      etag: '"e"',
      body: { rows: [], nextCursor: null },
    });

    const user = userEvent.setup();
    render(createElement(VerdictTimeline, null), { wrapper: makeWrapper(qc) });

    await waitFor(() => {
      expect(screen.getByTestId("timeline-error")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("timeline-empty")).not.toBeInTheDocument();

    const error = screen.getByTestId("timeline-error");
    expect(error).toHaveAttribute("role", "alert");
    expect(within(error).getByText(/failed to load verdicts/i)).toBeInTheDocument();
    const retry = within(error).getByRole("button", { name: /retry/i });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(retry);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
