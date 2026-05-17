import type { Decision } from "@scout/shared";
import { decisionIcon, decisionLabel, decisionPalette } from "../../theme.js";

/**
 * Render a verdict decision as color + icon + literal text (PRP 05 D9
 * + feature spec line 71; WCAG 2.1 § 1.4.1 Use of Color).
 *
 * Unknown decisions — i.e., a future `Decision` enum member surfaced
 * through the wire before this component is updated — render a neutral
 * "Unknown" chip and emit `console.warn`. Crashing the timeline on a
 * forward-compat wire value would be worse than degrading one badge.
 */
export function DecisionBadge({ decision }: { decision: Decision }): JSX.Element {
  const palette = decisionPalette as Record<string, string | undefined>;
  const color = palette[decision];
  if (color === undefined) {
    console.warn("DecisionBadge: unknown decision value", decision as unknown);
    return (
      <span
        data-testid="decision-badge-unknown"
        data-decision={String(decision)}
        style={{ color: "#525252", display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        <span aria-hidden>?</span>
        <span>Unknown</span>
      </span>
    );
  }
  const Icon = decisionIcon[decision];
  return (
    <span
      data-testid={`decision-badge-${decision}`}
      data-decision={decision}
      style={{ color, display: "inline-flex", alignItems: "center", gap: 4 }}
    >
      <span role="img" aria-label={decision} style={{ display: "inline-flex" }}>
        <Icon />
      </span>
      <span>{decisionLabel[decision]}</span>
    </span>
  );
}
