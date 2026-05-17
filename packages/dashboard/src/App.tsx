import { LobstertrapPane } from "./iframe/LobstertrapPane.js";

/**
 * Three-pane dashboard layout (feature spec line 24 + PRP 04 target).
 *
 * Slots render placeholder text the App.test.tsx assertions look up
 * via getByTestId; view bodies land in PRPs 05 (VerdictTimeline), 06
 * (ReasonsDrilldown), and 07 (IntentDiff tab inside the
 * lobstertrap pane). `App.tsx` stays a layout file; new state and
 * fetching go in the per-view components (D12 — extract if this file
 * exceeds 200 lines).
 */
export function App(): JSX.Element {
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
        {/* PRP 05 mounts <VerdictTimeline /> here. */}
        <p>Verdict Timeline</p>
      </section>
      <section
        data-testid="pane-drilldown"
        aria-label="Reasons Drilldown"
        style={{ gridArea: "drilldown", overflow: "auto" }}
      >
        {/* PRP 06 mounts <ReasonsDrilldown /> here. */}
        <p>Reasons Drilldown</p>
      </section>
      <section
        data-testid="pane-lobstertrap"
        aria-label="Lobster Trap"
        style={{ gridArea: "lobstertrap", overflow: "hidden" }}
      >
        {/* IntentDiff (PRP 07) lands as a tab inside this pane. */}
        <LobstertrapPane />
      </section>
    </main>
  );
}
