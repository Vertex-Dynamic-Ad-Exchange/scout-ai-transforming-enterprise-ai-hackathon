import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Reason } from "@scout/shared";
import { ReasonGroup } from "./ReasonGroup.js";

const SAMPLE: Reason[] = [
  { kind: "profile_signal", ref: "cat:gambling", detail: "Page flagged as gambling" },
  { kind: "profile_signal", ref: "ent:roulette", detail: "Entity 'roulette' detected" },
  { kind: "profile_signal", ref: "cat:adult", detail: "Adult content detected" },
];

describe("ReasonGroup", () => {
  it("renders the kind header with the count chip and one row per reason (happy)", () => {
    render(<ReasonGroup kind="profile_signal" reasons={SAMPLE} />);
    const group = screen.getByTestId("reason-group-profile_signal");
    expect(
      within(group).getByTestId("reason-group-count-profile_signal"),
    ).toHaveTextContent("3");
    expect(within(group).getByText(/Profile signal/i)).toBeInTheDocument();
    expect(within(group).getByText("cat:gambling")).toBeInTheDocument();
    expect(within(group).getByText("Page flagged as gambling")).toBeInTheDocument();
    expect(within(group).getByText("Entity 'roulette' detected")).toBeInTheDocument();
    expect(within(group).getByText("Adult content detected")).toBeInTheDocument();
  });

  it("renders the unknown bucket label as 'Other' verbatim (edge — forward-compat)", () => {
    render(
      <ReasonGroup
        kind="Other"
        reasons={[{ kind: "policy_rule", ref: "rule-x", detail: "Custom rule" }]}
      />,
    );
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("returns null when reasons[] is empty — no empty header (failure)", () => {
    const { container } = render(<ReasonGroup kind="fail_closed" reasons={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByTestId("reason-group-fail_closed"),
    ).not.toBeInTheDocument();
  });
});
