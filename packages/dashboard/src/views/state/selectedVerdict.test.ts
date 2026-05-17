import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  __resetSelectedVerdictId,
  __resetSelectedTab,
  getSelectedTab,
  getSelectedVerdictId,
  setSelectedTab,
  setSelectedVerdictId,
  subscribeSelectedTab,
  subscribeSelectedVerdictId,
  useSelectedTab,
  useSelectedVerdictId,
} from "./selectedVerdict.js";

// PRP 05 D9: cross-PRP state sharing is a module singleton driven by
// useSyncExternalStore. No context provider, no zustand — the
// downstream PRPs (06 ReasonsDrilldown, 07 IntentDiff) consume the
// same hook and must observe identical re-render semantics: a setter
// call with the same value is a no-op.

describe("selectedVerdict singleton", () => {
  afterEach(() => {
    __resetSelectedVerdictId();
  });

  it("setSelectedVerdictId('abc') fires subscribers and updates the getter (happy)", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSelectedVerdictId(listener);
    setSelectedVerdictId("abc");
    expect(getSelectedVerdictId()).toBe("abc");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("setSelectedVerdictId(null) clears the id and fires subscribers (edge — null is the back-to-none state)", () => {
    setSelectedVerdictId("abc");
    const listener = vi.fn();
    const unsubscribe = subscribeSelectedVerdictId(listener);
    setSelectedVerdictId(null);
    expect(getSelectedVerdictId()).toBeNull();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("a useSyncExternalStore consumer re-renders only when the id changes (failure — equal-set must not spam re-renders)", () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useSelectedVerdictId();
    });
    expect(renderCount).toBe(1);
    expect(result.current).toBeNull();

    act(() => setSelectedVerdictId("abc"));
    expect(result.current).toBe("abc");
    expect(renderCount).toBe(2);

    // Repeat-set with the same value must be a no-op.
    act(() => setSelectedVerdictId("abc"));
    expect(renderCount).toBe(2);

    act(() => setSelectedVerdictId("def"));
    expect(result.current).toBe("def");
    expect(renderCount).toBe(3);
  });
});

// PRP 07 D5: `selectedTab` is a sibling slice of the same singleton —
// pane-level preference (feature spec line 24), NOT a per-verdict one.
// The two slices are independent: setting one MUST NOT fire the other
// slice's listeners, and the default tab is "iframe" (iframe visible on
// initial mount; user opts into IntentDiff).
describe("selectedTab slice (PRP 07 D5)", () => {
  afterEach(() => {
    __resetSelectedTab();
    __resetSelectedVerdictId();
  });

  it("defaults to 'iframe' so the iframe is visible on initial mount (happy)", () => {
    expect(getSelectedTab()).toBe("iframe");
  });

  it("setSelectedTab('intent_diff') fires subscribers and updates the getter", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSelectedTab(listener);
    setSelectedTab("intent_diff");
    expect(getSelectedTab()).toBe("intent_diff");
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("setSelectedVerdictId does NOT reset selectedTab (edge — pane preference is sticky across row changes)", () => {
    setSelectedTab("intent_diff");
    setSelectedVerdictId("abc");
    expect(getSelectedTab()).toBe("intent_diff");
    setSelectedVerdictId("def");
    expect(getSelectedTab()).toBe("intent_diff");
  });

  it("setSelectedTab does NOT reset selectedVerdictId (edge — tab toggle is orthogonal to selection)", () => {
    setSelectedVerdictId("abc");
    setSelectedTab("intent_diff");
    expect(getSelectedVerdictId()).toBe("abc");
    setSelectedTab("iframe");
    expect(getSelectedVerdictId()).toBe("abc");
  });

  it("the tab subscriber is NOT fired when only selectedVerdictId changes (failure — cross-slice contamination would re-render unrelated views)", () => {
    const tabListener = vi.fn();
    const verdictListener = vi.fn();
    const offTab = subscribeSelectedTab(tabListener);
    const offVerdict = subscribeSelectedVerdictId(verdictListener);
    setSelectedVerdictId("abc");
    expect(verdictListener).toHaveBeenCalledOnce();
    expect(tabListener).not.toHaveBeenCalled();
    setSelectedTab("intent_diff");
    expect(verdictListener).toHaveBeenCalledOnce();
    expect(tabListener).toHaveBeenCalledOnce();
    offTab();
    offVerdict();
  });

  it("useSelectedTab consumer re-renders only when the tab changes", () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useSelectedTab();
    });
    expect(renderCount).toBe(1);
    expect(result.current).toBe("iframe");

    act(() => setSelectedTab("intent_diff"));
    expect(result.current).toBe("intent_diff");
    expect(renderCount).toBe(2);

    // Repeat-set with the same value must be a no-op.
    act(() => setSelectedTab("intent_diff"));
    expect(renderCount).toBe(2);

    act(() => setSelectedTab("iframe"));
    expect(result.current).toBe("iframe");
    expect(renderCount).toBe(3);
  });
});
