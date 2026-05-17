import { useSyncExternalStore } from "react";

/**
 * Cross-view selection singleton (PRP 05 D9 + PRP 07 D5): the verdict
 * timeline sets the active row's id; ReasonsDrilldown (PRP 06) and
 * IntentDiff (PRP 07) read it. The sibling `selectedTab` slice carries
 * the bottom-right pane preference ("iframe" | "intent_diff") so PRP 07
 * can toggle without unmounting the iframe (D6 — preserves the
 * ~500ms cold-load state).
 *
 * Two slices, two listener pools. A selectedVerdictId change MUST NOT
 * fire the selectedTab subscribers (and vice versa); cross-slice
 * contamination would force unrelated views to re-render on every row
 * select. `useSyncExternalStore` is the React-blessed seam for
 * module-level state — no Context provider needed and no new dependency.
 */
type Listener = () => void;

let currentId: string | null = null;
const idListeners = new Set<Listener>();

export function setSelectedVerdictId(id: string | null): void {
  if (id === currentId) return;
  currentId = id;
  for (const l of idListeners) l();
}

export function getSelectedVerdictId(): string | null {
  return currentId;
}

export function subscribeSelectedVerdictId(listener: Listener): () => void {
  idListeners.add(listener);
  return () => {
    idListeners.delete(listener);
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
  currentId = null;
  idListeners.clear();
}

export type SelectedTab = "iframe" | "intent_diff";

let currentTab: SelectedTab = "iframe";
const tabListeners = new Set<Listener>();

export function setSelectedTab(tab: SelectedTab): void {
  if (tab === currentTab) return;
  currentTab = tab;
  for (const l of tabListeners) l();
}

export function getSelectedTab(): SelectedTab {
  return currentTab;
}

export function subscribeSelectedTab(listener: Listener): () => void {
  tabListeners.add(listener);
  return () => {
    tabListeners.delete(listener);
  };
}

export function useSelectedTab(): SelectedTab {
  return useSyncExternalStore(subscribeSelectedTab, getSelectedTab, getSelectedTab);
}

export function __resetSelectedTab(): void {
  currentTab = "iframe";
  tabListeners.clear();
}
