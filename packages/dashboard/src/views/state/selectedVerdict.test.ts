import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  __resetSelectedVerdictId,
  getSelectedVerdictId,
  setSelectedVerdictId,
  subscribeSelectedVerdictId,
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
