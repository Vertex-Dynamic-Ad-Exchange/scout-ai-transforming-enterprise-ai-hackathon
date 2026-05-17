import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { AuditRow, Decision } from "@scout/shared";

// Hoisted mock — perf test must not hit the real fetch path.
vi.mock("../api/client.js", () => ({
  listVerdicts: vi.fn(),
  fetchVerdicts: vi.fn(() => new Promise(() => undefined)),
  getVerdict: vi.fn(),
  evidenceUrl: vi.fn(),
}));

import { fetchVerdicts } from "../api/client.js";
import { VerdictTimeline } from "./VerdictTimeline.js";

const fetchMock = vi.mocked(fetchVerdicts);

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }): ReactNode =>
    createElement(QueryClientProvider, { client: qc }, children);
}

function rotatingDecision(i: number): Decision {
  // Plausible mix across the fixture: ~70% ALLOW, ~25% DENY, ~5% HUMAN_REVIEW.
  if (i % 20 === 0) return "HUMAN_REVIEW";
  if (i % 4 === 0) return "DENY";
  return "ALLOW";
}

function buildThousandRows(): AuditRow[] {
  const rows: AuditRow[] = [];
  for (let i = 0; i < 1000; i++) {
    rows.push({
      kind: "verdict",
      id: `v-${i}`,
      advertiserId: "demo-advertiser",
      ts: "2026-05-17T12:00:00.000Z",
      request: {
        advertiserId: "demo-advertiser",
        policyId: "p1",
        pageUrl: `https://example.com/path/${i}`,
        creativeRef: `c-${i}`,
        geo: "US",
        ts: "2026-05-17T12:00:00.000Z",
      },
      verdict: {
        decision: rotatingDecision(i),
        reasons: [],
        profileId: "prof-1",
        policyVersion: "policy-v1",
        latencyMs: 40 + (i % 50),
        lobstertrapTraceId: i % 3 === 0 ? `trace-${i}` : null,
      },
      profile: null,
      declaredIntent: null,
      detectedIntent: null,
    });
  }
  return rows;
}

describe("<VerdictTimeline /> — perf gate (PRP 05 step 11, feature spec lines 56-60)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    fetchMock.mockReset();
    fetchMock.mockReturnValue(new Promise(() => undefined));
  });

  afterEach(() => {
    qc.clear();
  });

  it("renders ≤ 25 row DOM nodes for a 1000-row fixture (virtualizer overscan window — feature spec line 57)", async () => {
    const rows = buildThousandRows();
    // Pre-seed the cache so the initial render reads synchronously
    // and the suspended fetchVerdicts mock never resolves.
    qc.setQueryData(["verdicts", { kind: "verdict" }], {
      rows,
      nextCursor: null,
    });

    render(createElement(VerdictTimeline, null), { wrapper: makeWrapper(qc) });

    await waitFor(() => {
      expect(screen.queryAllByTestId(/^verdict-row-/).length).toBeGreaterThan(0);
    });

    const renderedRows = screen.queryAllByTestId(/^verdict-row-/);
    // Visible 600 / 56 ≈ 11 + overscan 5 on each side ≈ 21, padded
    // with headroom. ≤ 25 is the bar the PRP locks; a 1000-row list
    // that renders 1000 row nodes is the jank failure mode.
    expect(renderedRows.length).toBeLessThanOrEqual(25);
    expect(renderedRows.length).toBeGreaterThanOrEqual(5);
  });

  // Per-frame paint-time measurement under jsdom is unreliable —
  // jsdom skips layout entirely, so `performance.now()` deltas
  // around `render()` reflect React reconciliation cost only, NOT
  // the paint cost a real browser would incur. The PRP explicitly
  // allows `it.skip` rather than a hand-tuned always-passing
  // threshold. Re-enable under `vitest-browser` or a Playwright
  // harness when one lands.
  it.skip("renders the 1000-row fixture under 100ms in jsdom (skipped — re-enable under vitest-browser/Playwright)", () => {
    // intentionally empty; this `it.skip` documents the gap.
  });
});
