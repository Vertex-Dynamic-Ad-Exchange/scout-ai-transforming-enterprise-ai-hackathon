import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api/client.js", () => ({
  fetchVerdicts: vi.fn(),
  listVerdicts: vi.fn(),
  getVerdict: vi.fn(),
  evidenceUrl: vi.fn(),
}));

import { fetchVerdicts, getVerdict } from "./api/client.js";
import { App } from "./App.js";
import {
  __resetSelectedVerdictId,
  setSelectedVerdictId,
} from "./views/state/selectedVerdict.js";
import type { AuditRow } from "@scout/shared";

const LT_URL = "http://localhost:8080/_lobstertrap/";

const fetchVerdictsMock = vi.mocked(fetchVerdicts);
const getVerdictMock = vi.mocked(getVerdict);

// Per-test QueryClient so React Query state never leaks across cases —
// shared `queryClient.ts` is the production singleton and a stale
// cache would couple e.g. PRP 03's empty-state test to PRP 05's
// happy-fetch test once they land.
function renderApp(): void {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 500 } },
  });
  render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>,
  );
}

describe("<App />", () => {
  beforeEach(() => {
    // import.meta.env.VITE_LOBSTERTRAP_URL drives the iframe src; stub
    // it here so the test is independent of the developer's .env file.
    vi.stubEnv("VITE_LOBSTERTRAP_URL", LT_URL);
    __resetSelectedVerdictId();
    fetchVerdictsMock.mockReset();
    fetchVerdictsMock.mockResolvedValue({
      status: 200,
      etag: null,
      body: { rows: [], nextCursor: null },
    });
    getVerdictMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the three-pane layout with the Lobster Trap iframe sourced from VITE_LOBSTERTRAP_URL (preserves foundation task 8 assertion)", () => {
    renderApp();
    expect(screen.getByTestId("pane-timeline")).toBeInTheDocument();
    expect(screen.getByTestId("pane-drilldown")).toBeInTheDocument();
    expect(screen.getByTestId("pane-lobstertrap")).toBeInTheDocument();
    expect(screen.getByTitle(/lobster trap/i)).toHaveAttribute("src", LT_URL);
  });

  it("renders a loading skeleton before the iframe onLoad fires, then clears it", () => {
    renderApp();
    // Pre-load: skeleton text visible.
    expect(screen.getByText(/loading lobster trap audit ui/i)).toBeInTheDocument();
    // Simulate the browser firing iframe load. RTL has no real layout
    // engine so `onLoad` would never fire spontaneously in jsdom.
    fireEvent.load(screen.getByTitle(/lobster trap/i));
    expect(screen.queryByText(/loading lobster trap audit ui/i)).not.toBeInTheDocument();
  });

  it("mounts <ReasonsDrilldown /> in the top-right pane — null branch leaves the drilldown DOM empty until a row is selected (PRP 06 Task 12)", () => {
    renderApp();
    const pane = screen.getByTestId("pane-drilldown");
    expect(pane).toBeInTheDocument();
    // No selection → Drilldown returns null. The pane wrapper stays
    // in the DOM (App.tsx layout slot), but the Drilldown root is
    // absent.
    expect(pane.querySelector("[data-testid='drilldown']")).toBeNull();
    expect(pane.textContent ?? "").toBe("");
    // No verdict fetch fires for the empty-selection state.
    expect(getVerdictMock).not.toHaveBeenCalled();
  });

  it("renders reasons in the drilldown pane when a row is selected and the API responds (PRP 06 Task 12)", async () => {
    const row: AuditRow = {
      kind: "verdict",
      id: "v1",
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
        decision: "DENY",
        reasons: [{ kind: "policy_rule", ref: "rule-x", detail: "fires" }],
        profileId: "prof-1",
        policyVersion: "policy-v1",
        latencyMs: 47,
        lobstertrapTraceId: "lt-1",
      },
      profile: null,
      declaredIntent: null,
      detectedIntent: null,
    };
    getVerdictMock.mockResolvedValueOnce(row);
    renderApp();
    act(() => setSelectedVerdictId("v1"));

    await waitFor(() => {
      expect(screen.getByTestId("reason-group-policy_rule")).toBeInTheDocument();
    });
    expect(getVerdictMock).toHaveBeenCalledWith("v1", expect.any(Object));
  });

  it("swaps the iframe for an external fallback link when onError fires (D7 — no auto-retry)", () => {
    renderApp();
    fireEvent.error(screen.getByTitle(/lobster trap/i));
    const link = screen.getByRole("link", {
      name: /open lobster trap dashboard in new tab/i,
    });
    expect(link).toHaveAttribute("href", LT_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
    // The iframe must be gone — auto-retry would hide the underlying CSP /
    // availability bug (PRP 04 § Decisions D7).
    expect(screen.queryByTitle(/lobster trap/i)).not.toBeInTheDocument();
  });
});
