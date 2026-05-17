import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { DivergenceCallout } from "./DivergenceCallout.js";
import { DIVERGENCE_HEADING, ALIGNED_INTENT_LABEL } from "../messages.js";

// PRP 07 D1: divergence text comes from Lobster Trap audit rows —
// untrusted, may contain attacker-controlled content echoed back from a
// successfully prompt-injected page. React's auto-escape is the only
// renderer; `dangerouslySetInnerHTML` is banned across the IntentDiff
// surface. D3: the divergence signal is color + heading + body, never
// color-only (WCAG 2.1 § 1.4.1). D4: an empty-string `divergence`
// renders the aligned (green) state, NOT amber — defends against
// truthy-empty bugs upstream.

describe("<DivergenceCallout />", () => {
  it("happy — non-empty divergence renders amber callout with heading + body (D3 — color + heading + body)", () => {
    render(
      createElement(DivergenceCallout, {
        divergence: "Detected scope expanded beyond declared classification",
      }),
    );
    const callout = screen.getByTestId("divergence-callout-amber");
    expect(callout).toBeInTheDocument();
    expect(callout).toHaveAttribute("role", "alert");
    // Heading literal is pinned in messages.ts so the App.demo test
    // can import it.
    expect(
      screen.getByRole("heading", { name: new RegExp(DIVERGENCE_HEADING, "i") }),
    ).toBeInTheDocument();
    expect(callout).toHaveTextContent(/detected scope expanded beyond declared classification/i);
  });

  it("edge — null divergence renders the aligned green badge, not amber", () => {
    render(createElement(DivergenceCallout, { divergence: null }));
    expect(screen.getByTestId("divergence-aligned")).toBeInTheDocument();
    expect(screen.queryByTestId("divergence-callout-amber")).not.toBeInTheDocument();
    expect(screen.getByTestId("divergence-aligned")).toHaveTextContent(ALIGNED_INTENT_LABEL);
  });

  it("failure — empty-string divergence renders the aligned green badge, NOT amber (D4 — truthy-empty defense)", () => {
    render(createElement(DivergenceCallout, { divergence: "" }));
    expect(screen.getByTestId("divergence-aligned")).toBeInTheDocument();
    expect(screen.queryByTestId("divergence-callout-amber")).not.toBeInTheDocument();
  });

  it("security — divergence body containing a <script> tag does NOT inject a real script (D1 — React auto-escape)", () => {
    const { container } = render(
      createElement(DivergenceCallout, {
        divergence: "<script>alert(1)</script>",
      }),
    );
    expect(container.querySelector("script")).toBeNull();
    // The text payload is still surfaced verbatim — judge can see the
    // attacker-attempted payload as readable text, escaped.
    expect(screen.getByTestId("divergence-callout-amber")).toHaveTextContent(
      "<script>alert(1)</script>",
    );
  });
});
