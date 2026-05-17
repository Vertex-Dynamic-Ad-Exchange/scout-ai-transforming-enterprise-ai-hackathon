import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DecisionBadge } from "./DecisionBadge.js";
import { decisionPalette } from "../../theme.js";

// DecisionBadge contract (PRP 05 D9 + feature spec line 71): color +
// icon + literal text. Never color-only. Unknown decision values must
// fall back to a neutral chip and warn, never throw — forward-compat
// for a future Decision enum member.

describe("<DecisionBadge />", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders ALLOW with the green hex from theme palette, check-circle svg, and literal 'ALLOW' text", () => {
    render(<DecisionBadge decision="ALLOW" />);
    const badge = screen.getByTestId("decision-badge-ALLOW");
    expect(badge).toHaveAttribute("data-decision", "ALLOW");
    expect(badge).toHaveStyle({ color: decisionPalette.ALLOW });
    expect(badge).toHaveTextContent("ALLOW");
    // Icon carries the aria-label, not the wrapper — the wrapper has
    // text. Screen readers therefore announce both label and text.
    expect(screen.getByLabelText("ALLOW")).toBeInTheDocument();
  });

  it("renders HUMAN_REVIEW with the amber hex, alert-circle svg, and 'HUMAN REVIEW' literal text (edge — multi-word label)", () => {
    render(<DecisionBadge decision="HUMAN_REVIEW" />);
    const badge = screen.getByTestId("decision-badge-HUMAN_REVIEW");
    expect(badge).toHaveStyle({ color: decisionPalette.HUMAN_REVIEW });
    expect(badge).toHaveTextContent("HUMAN REVIEW");
    expect(screen.getByLabelText("HUMAN_REVIEW")).toBeInTheDocument();
  });

  it("falls back to a neutral chip + console.warn for an unknown decision value (failure — never throws)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // `as any` is the point of the test: a forward-compat enum member
    // smuggled in from the wire must not crash the timeline.
    expect(() =>
      render(<DecisionBadge decision={"FUTURE_KIND" as never} />),
    ).not.toThrow();
    const fallback = screen.getByTestId("decision-badge-unknown");
    expect(fallback).toHaveTextContent(/unknown/i);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("DecisionBadge"),
      "FUTURE_KIND",
    );
  });
});
