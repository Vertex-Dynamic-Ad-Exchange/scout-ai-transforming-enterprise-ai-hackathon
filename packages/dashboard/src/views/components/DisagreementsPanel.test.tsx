import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DisagreementsPanel,
  type Disagreement,
} from "./DisagreementsPanel.js";

const SAMPLE: Disagreement = {
  kind: "decision",
  label: "ALLOW",
  perVerifier: { text: 0.85, image: 0.15, video: 0.55 },
};

describe("DisagreementsPanel", () => {
  it("HUMAN_REVIEW + one disagreement renders three ConfidenceBars, one per verifier (happy)", () => {
    render(
      <DisagreementsPanel decision="HUMAN_REVIEW" disagreements={[SAMPLE]} />,
    );
    expect(screen.getByTestId("disagreements-panel")).toBeInTheDocument();
    expect(
      screen.getByTestId("disagreement-decision-ALLOW-text"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("disagreement-decision-ALLOW-image"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("disagreement-decision-ALLOW-video"),
    ).toBeInTheDocument();
    // Three bars total.
    expect(screen.getAllByTestId("confidence-bar")).toHaveLength(3);
  });

  it("HUMAN_REVIEW + empty disagreements renders the exact D5 fallback string (edge — below-threshold escalation)", () => {
    render(<DisagreementsPanel decision="HUMAN_REVIEW" disagreements={[]} />);
    expect(screen.getByTestId("disagreements-empty-fallback")).toHaveTextContent(
      "Confidence below threshold — see profile signals",
    );
  });

  it("decision=ALLOW returns null even when disagreements are present (failure — wrong-decision render)", () => {
    const { container } = render(
      <DisagreementsPanel decision="ALLOW" disagreements={[SAMPLE]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("decision=DENY also returns null (panel is HUMAN_REVIEW-only)", () => {
    const { container } = render(
      <DisagreementsPanel decision="DENY" disagreements={[SAMPLE]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
