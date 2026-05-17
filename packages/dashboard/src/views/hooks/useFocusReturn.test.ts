import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { useFocusReturn } from "./useFocusReturn.js";

function Harness(): JSX.Element {
  const { headingRef } = useFocusReturn();
  return createElement(
    "h2",
    { ref: headingRef, tabIndex: -1, "data-testid": "harness-h" },
    "test",
  );
}

describe("useFocusReturn", () => {
  it("focuses the heading element on mount", () => {
    render(createElement(Harness));
    const h = document.querySelector("[data-testid='harness-h']");
    expect(document.activeElement).toBe(h);
  });

  it("exposes a returnFocus callback (smoke — no-throw when invoked)", () => {
    let captured: (() => void) | undefined;
    function Capture(): JSX.Element {
      const { headingRef, returnFocus } = useFocusReturn();
      captured = returnFocus;
      return createElement("h2", { ref: headingRef, tabIndex: -1 }, "x");
    }
    render(createElement(Capture));
    expect(typeof captured).toBe("function");
    expect(() => captured!()).not.toThrow();
  });
});
