import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidenceBar, clampConfidence } from "./ConfidenceBar.js";

describe("ConfidenceBar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders width 50% for value 0.5 (happy)", () => {
    render(<ConfidenceBar value={0.5} label="text" />);
    const fill = screen.getByTestId("confidence-bar-fill");
    expect(fill).toHaveStyle({ width: "50%" });
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0.5",
    );
  });

  it("renders 0% for value 0 and 100% for value 1 (edge — boundaries)", () => {
    const { unmount } = render(<ConfidenceBar value={0} />);
    expect(screen.getByTestId("confidence-bar-fill")).toHaveStyle({ width: "0%" });
    unmount();

    render(<ConfidenceBar value={1} />);
    expect(screen.getByTestId("confidence-bar-fill")).toHaveStyle({ width: "100%" });
  });

  it("clamps value > 1 to 100% without throwing (edge — out of range)", () => {
    render(<ConfidenceBar value={1.5} />);
    expect(screen.getByTestId("confidence-bar-fill")).toHaveStyle({ width: "100%" });
  });

  it("collapses NaN to 0% and warns once (failure — malformed verifier confidence)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<ConfidenceBar value={Number.NaN} />);
    expect(screen.getByTestId("confidence-bar-fill")).toHaveStyle({ width: "0%" });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("clampConfidence is the extracted pure helper (refactor pin)", () => {
    expect(clampConfidence(0.25)).toBe(0.25);
    expect(clampConfidence(-1)).toBe(0);
    expect(clampConfidence(2)).toBe(1);
    expect(clampConfidence(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
