import { useSyncExternalStore } from "react";

/**
 * Cross-view selection singleton (PRP 05 D9): the verdict timeline
 * sets the active row's id; ReasonsDrilldown (PRP 06) and IntentDiff
 * (PRP 07) read it. `useSyncExternalStore` is the React-blessed seam
 * for module-level state — no Context provider needed and no new
 * dependency.
 */
type Listener = () => void;

let current: string | null = null;
const listeners = new Set<Listener>();

export function setSelectedVerdictId(id: string | null): void {
  if (id === current) return;
  current = id;
  for (const l of listeners) l();
}

export function getSelectedVerdictId(): string | null {
  return current;
}

export function subscribeSelectedVerdictId(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSelectedVerdictId(): string | null {
  return useSyncExternalStore(
    subscribeSelectedVerdictId,
    getSelectedVerdictId,
    getSelectedVerdictId,
  );
}

// Test-only: vitest's module isolation does not reset module-scoped
// state between tests in the same file. Exported as `__`-prefixed to
// signal "do not call from production code".
export function __resetSelectedVerdictId(): void {
  current = null;
  listeners.clear();
}
