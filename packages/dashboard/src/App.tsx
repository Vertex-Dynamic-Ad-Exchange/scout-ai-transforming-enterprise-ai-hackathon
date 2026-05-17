import type { CSSProperties } from "react";
import { LobstertrapPane } from "./iframe/LobstertrapPane.js";
import { VerdictTimeline } from "./views/VerdictTimeline.js";
import { ReasonsDrilldown } from "./views/ReasonsDrilldown.js";
import { IntentDiff } from "./views/IntentDiff.js";
import { setSelectedTab, useSelectedTab } from "./views/state/selectedVerdict.js";

/**
 * Three-pane dashboard layout (feature spec line 24 + PRP 04 target).
 *
 * Bottom-right pane carries a two-tab switcher: "Lobster Trap" (the
 * iframe, default) and "Intent Diff" (the Veea-Award showpiece view).
 * Both panes mount on first paint and stay mounted across tab toggles —
 * the inactive pane uses the `hidden` attribute (PRP 07 D6) rather than
 * unmounting, so the Lobster Trap iframe keeps its ~500ms cold-load
 * state and the IntentDiff render doesn't re-fire a backend fetch on
 * every toggle.
 *
 * The tablist is the only piece of layout chrome owned by `App.tsx`;
 * row selection, polling cadence, divergence rendering, and the audit
 * iframe live in their per-view modules.
 */
export function App(): JSX.Element {
  const tab = useSelectedTab();
  return (
    <main
      data-testid="dashboard-root"
      style={{
        display: "grid",
        gridTemplateColumns: "40% 60%",
        gridTemplateRows: "60% 40%",
        gridTemplateAreas: `"timeline drilldown" "timeline lobstertrap"`,
        height: "100vh",
        width: "100vw",
      }}
    >
      <section
        data-testid="pane-timeline"
        aria-label="Verdict Timeline"
        style={{ gridArea: "timeline", overflow: "auto" }}
      >
        <VerdictTimeline />
      </section>
      <section
        data-testid="pane-drilldown"
        aria-label="Reasons Drilldown"
        style={{ gridArea: "drilldown", overflow: "auto" }}
      >
        <ReasonsDrilldown />
      </section>
      <section
        data-testid="pane-lobstertrap"
        aria-label="Audit surface"
        style={{
          gridArea: "lobstertrap",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <nav
          role="tablist"
          aria-label="Audit surface tabs"
          data-testid="lobstertrap-tablist"
          style={{ display: "flex", gap: 4, padding: "4px 8px 0" }}
        >
          <button
            type="button"
            role="tab"
            data-testid="tab-iframe"
            aria-selected={tab === "iframe"}
            aria-controls="tab-pane-iframe"
            onClick={() => setSelectedTab("iframe")}
            style={tabButtonStyle(tab === "iframe")}
          >
            Lobster Trap
          </button>
          <button
            type="button"
            role="tab"
            data-testid="tab-intent-diff"
            aria-selected={tab === "intent_diff"}
            aria-controls="tab-pane-intent-diff"
            onClick={() => setSelectedTab("intent_diff")}
            style={tabButtonStyle(tab === "intent_diff")}
          >
            Intent Diff
          </button>
        </nav>
        <div
          id="tab-pane-iframe"
          role="tabpanel"
          aria-labelledby="tab-iframe"
          data-testid="tab-pane-iframe"
          hidden={tab !== "iframe"}
          style={{ flex: 1, minHeight: 0 }}
        >
          <LobstertrapPane />
        </div>
        <div
          id="tab-pane-intent-diff"
          role="tabpanel"
          aria-labelledby="tab-intent-diff"
          data-testid="tab-pane-intent-diff"
          hidden={tab !== "intent_diff"}
          style={{ flex: 1, minHeight: 0, overflow: "auto" }}
        >
          <IntentDiff />
        </div>
      </section>
    </main>
  );
}

function tabButtonStyle(selected: boolean): CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 13,
    border: "1px solid #d4d4d4",
    borderRadius: 4,
    background: selected ? "#1f2937" : "#ffffff",
    color: selected ? "#ffffff" : "#1f2937",
    cursor: "pointer",
  };
}
