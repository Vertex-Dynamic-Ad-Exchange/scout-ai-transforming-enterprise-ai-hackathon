import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { axe } from "vitest-axe";

vi.mock("./api/client.js", () => ({
  fetchVerdicts: vi.fn(),
  listVerdicts: vi.fn(),
  getVerdict: vi.fn(),
  evidenceUrl: vi.fn(),
}));

import { fetchVerdicts, getVerdict } from "./api/client.js";
import { App } from "./App.js";
import { __resetSelectedTab, __resetSelectedVerdictId } from "./views/state/selectedVerdict.js";
import { MockAuditClient } from "./api/MockAuditClient.js";
import { DEMO_SCENARIOS } from "./fixtures/demoScenarios.js";
import { DIVERGENCE_HEADING } from "./views/messages.js";
import type { AuditRow } from "@scout/shared";

// PRP 07 Task 12 — five-scenario demo regression. Every claim in the
// feature file's *Demo stakes* (lines 5-7) is substantiated here, and
// PRP 07 Task 13 — axe-core WCAG 2.1 AA audit on the full App tree
// (all three views mounted together; per-view audits miss cross-view
// contrast and landmark interactions).
//
// The fixtures live in `DEMO_SCENARIOS` and the seam is `MockAuditClient`
// (D10). The api/client.js module is mocked at the boundary so the
// dashboard runs end-to-end without standing up Fastify; the mock is
// thin: it forwards to MockAuditClient.query / .get.

const LT_URL = "http://localhost:8080/_lobstertrap/";

const fetchVerdictsMock = vi.mocked(fetchVerdicts);
const getVerdictMock = vi.mocked(getVerdict);

function bindMockClient(client: MockAuditClient): void {
  fetchVerdictsMock.mockImplementation(async (params) => {
    const filter: Parameters<typeof client.query>[0] = {};
    if (params?.kind !== undefined) filter.kind = params.kind;
    const { rows, nextCursor } = client.query(filter);
    return { status: 200 as const, etag: '"demo"', body: { rows, nextCursor } };
  });
  getVerdictMock.mockImplementation(async (id) => client.get(id));
}

function renderApp(): { container: HTMLElement; qc: QueryClient } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 500, gcTime: 0 } },
  });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <App />
    </QueryClientProvider>,
  );
  return { container, qc };
}

function asVerdictRow(row: AuditRow): Extract<AuditRow, { kind: "verdict" }> {
  if (row.kind !== "verdict") throw new Error("expected verdict row");
  return row;
}

interface BadgeAssertion {
  decision: "ALLOW" | "DENY" | "HUMAN_REVIEW";
  text: string;
}

const BADGE_FOR: Record<string, BadgeAssertion> = {
  ALLOW: { decision: "ALLOW", text: "ALLOW" },
  DENY: { decision: "DENY", text: "DENY" },
  HUMAN_REVIEW: { decision: "HUMAN_REVIEW", text: "HUMAN REVIEW" },
};

async function findRowAfterTimelineLoad(rowId: string): Promise<HTMLElement> {
  return await waitFor(() => {
    const el = screen.getByTestId(`verdict-row-${rowId}`);
    expect(el).toBeInTheDocument();
    return el;
  });
}

function assertBadge(rowEl: HTMLElement, expectation: BadgeAssertion): void {
  const badge = within(rowEl).getByTestId(`decision-badge-${expectation.decision}`);
  expect(badge).toBeInTheDocument();
  // Color carried via inline style (`color: <palette>`); icon is the
  // <svg> with role="img"; text label is the literal. All three signal
  // the decision (feature spec line 71; WCAG 2.1 § 1.4.1).
  expect(badge.querySelector("svg")).not.toBeNull();
  expect(badge).toHaveTextContent(expectation.text);
}

async function assertTabEnterEscapeFocus(rowEl: HTMLElement): Promise<void> {
  const user = userEvent.setup();
  rowEl.focus();
  expect(document.activeElement).toBe(rowEl);
  await user.keyboard("{Enter}");
  // Enter sets `selectedVerdictId`; the drilldown begins fetching.
  await waitFor(() => {
    expect(screen.queryByTestId("drilldown-loading")).not.toBeInTheDocument();
  });
  // Escape returns focus to the scroller (parent of the row).
  rowEl.focus();
  await user.keyboard("{Escape}");
  const scroller = screen.getByTestId("timeline-scroller");
  expect(document.activeElement).toBe(scroller);
}

function assertIframeCoexists(): void {
  // D6: even after a future tab toggle, the iframe stays mounted.
  expect(screen.getByTitle(/lobster trap/i)).toBeInTheDocument();
}

describe("App.demo — five-scenario regression (PRP 07 Task 12)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_LOBSTERTRAP_URL", LT_URL);
    __resetSelectedVerdictId();
    __resetSelectedTab();
    fetchVerdictsMock.mockReset();
    getVerdictMock.mockReset();
    bindMockClient(new MockAuditClient());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("Scenario 1 — Clean ALLOW", () => {
    it("badge ALLOW (color + icon + text); Enter opens drilldown; Escape returns focus; iframe coexists", async () => {
      renderApp();
      const row = asVerdictRow(DEMO_SCENARIOS[0]!.row);
      const rowEl = await findRowAfterTimelineLoad(row.id);
      assertBadge(rowEl, BADGE_FOR[row.verdict.decision]!);
      await assertTabEnterEscapeFocus(rowEl);
      assertIframeCoexists();
    });
  });

  describe("Scenario 2 — Clean DENY", () => {
    it("badge DENY; Enter/Escape behavior; iframe coexists", async () => {
      renderApp();
      const row = asVerdictRow(DEMO_SCENARIOS[1]!.row);
      const rowEl = await findRowAfterTimelineLoad(row.id);
      assertBadge(rowEl, BADGE_FOR[row.verdict.decision]!);
      await assertTabEnterEscapeFocus(rowEl);
      assertIframeCoexists();
    });
  });

  describe("Scenario 3 — Ambiguous Flash escalation (DENY via fail_closed)", () => {
    it("badge DENY; Enter/Escape behavior; iframe coexists", async () => {
      renderApp();
      const row = asVerdictRow(DEMO_SCENARIOS[2]!.row);
      const rowEl = await findRowAfterTimelineLoad(row.id);
      assertBadge(rowEl, BADGE_FOR[row.verdict.decision]!);
      await assertTabEnterEscapeFocus(rowEl);
      assertIframeCoexists();
    });
  });

  describe("Scenario 4 — HUMAN_REVIEW arbiter disagreement (SHOWPIECE)", () => {
    it("badge HUMAN REVIEW; Intent Diff tab surfaces the divergence heading; iframe stays mounted across tab toggle (D6)", async () => {
      renderApp();
      const row = asVerdictRow(DEMO_SCENARIOS[3]!.row);
      const rowEl = await findRowAfterTimelineLoad(row.id);
      assertBadge(rowEl, BADGE_FOR[row.verdict.decision]!);
      await assertTabEnterEscapeFocus(rowEl);

      // Open the drilldown by selecting the row.
      rowEl.focus();
      const user = userEvent.setup();
      await user.keyboard("{Enter}");

      // Iframe is the initial tab — still in DOM.
      expect(screen.getByTitle(/lobster trap/i)).toBeInTheDocument();

      // Click the Intent Diff tab.
      const intentTab = screen.getByTestId("tab-intent-diff");
      await user.click(intentTab);

      // The Veea moment: the pinned divergence heading is now visible.
      await waitFor(() => {
        expect(
          screen.getByRole("heading", {
            name: new RegExp(DIVERGENCE_HEADING, "i"),
          }),
        ).toBeInTheDocument();
      });
      expect(screen.getByTestId("divergence-callout-amber")).toBeInTheDocument();

      // D6: iframe MUST still be in the DOM after the tab toggle —
      // unmounting would drop the ~500ms cold-load state and re-fetch
      // Veea's UI on every toggle.
      expect(screen.getByTitle(/lobster trap/i)).toBeInTheDocument();
    });
  });

  describe("Scenario 5 — Cache-miss DENY (cold) then ALLOW (warm)", () => {
    it("both rows render in the timeline; cold row has no Lobster Trap chip; warm row has the chip", async () => {
      renderApp();
      const cold = asVerdictRow(DEMO_SCENARIOS[4]!.row);
      const warm = asVerdictRow(DEMO_SCENARIOS[5]!.row);
      const coldEl = await findRowAfterTimelineLoad(cold.id);
      const warmEl = await findRowAfterTimelineLoad(warm.id);

      assertBadge(coldEl, BADGE_FOR[cold.verdict.decision]!);
      assertBadge(warmEl, BADGE_FOR[warm.verdict.decision]!);

      // Chip presence dial (feature spec line 67): non-null
      // lobstertrapTraceId → chip present; null → chip absent.
      expect(within(warmEl).getByTestId(`lobstertrap-chip-${warm.id}`)).toBeInTheDocument();
      expect(within(coldEl).queryByTestId(`lobstertrap-chip-${cold.id}`)).not.toBeInTheDocument();

      // Cold row → IntentDiff returns null (no trace id → no diff to
      // show). Pin via the drilldown path: opening the cold row's
      // intent diff tab renders nothing.
      const user = userEvent.setup();
      coldEl.focus();
      await user.keyboard("{Enter}");
      await user.click(screen.getByTestId("tab-intent-diff"));
      // Empty intent diff pane — no `intent-diff` testid, no
      // divergence callout, no empty-declared panel (the gate before
      // declaredIntent === null is `lobstertrapTraceId === null` which
      // returns earlier).
      expect(screen.queryByTestId("intent-diff")).not.toBeInTheDocument();
      expect(screen.queryByTestId("divergence-callout-amber")).not.toBeInTheDocument();
    });
  });
});

describe("App.demo — axe-core WCAG 2.1 AA audit (PRP 07 Task 13)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_LOBSTERTRAP_URL", LT_URL);
    __resetSelectedVerdictId();
    __resetSelectedTab();
    fetchVerdictsMock.mockReset();
    getVerdictMock.mockReset();
    bindMockClient(new MockAuditClient());
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders all five scenarios + iframe and reports zero AA violations across the App tree (D7 — wcag2a + wcag2aa, NOT aaa)", async () => {
    const { container } = renderApp();

    // Wait for the timeline to settle into a non-empty render.
    await findRowAfterTimelineLoad(DEMO_SCENARIOS[0]!.row.id);

    // Open the HUMAN_REVIEW row's drilldown + Intent Diff tab so the
    // audit covers the Veea moment, not just the empty initial state.
    const showpiece = asVerdictRow(DEMO_SCENARIOS[3]!.row);
    const showpieceEl = await findRowAfterTimelineLoad(showpiece.id);
    showpieceEl.focus();
    const user = userEvent.setup();
    await user.keyboard("{Enter}");
    await waitFor(() => {
      expect(screen.getByTestId("drilldown")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("tab-intent-diff"));
    await waitFor(() => {
      expect(screen.getByTestId("divergence-callout-amber")).toBeInTheDocument();
    });

    // jsdom does not load the iframe; firing the load event clears the
    // skeleton placeholder so axe's "label" rule does not flag the
    // (cosmetic) skeleton text. Real demo machine fires load
    // automatically.
    fireEvent.load(screen.getByTitle(/lobster trap/i));

    const results = await axe(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    // Surface the offenders in the assertion message rather than just
    // a bare length comparison so a future palette tweak that flips
    // contrast prints the offending node directly in CI.
    expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  }, 15_000);
});
