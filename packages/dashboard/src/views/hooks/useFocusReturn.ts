import { useCallback, useEffect, useRef } from "react";

/**
 * Disclosure-pattern focus management hook (PRP 06 Task 13 + D9 + the
 * WAI-ARIA disclosure pattern).
 *
 * On mount the disclosed heading receives focus so screen-reader users
 * land on the verdict title. `returnFocus` is exposed for PRP 05's
 * Escape handler to call from the Timeline row — this PRP only
 * provides the surface; the wiring lives in the invoker.
 *
 * The heading needs `tabIndex={-1}` to receive programmatic focus.
 * Without `tabIndex`, jsdom (and some real browsers) silently no-op
 * `focus()` on a `<h2>`.
 */
export interface FocusReturn {
  headingRef: React.RefObject<HTMLHeadingElement>;
  returnFocus: () => void;
}

export function useFocusReturn(): FocusReturn {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    return () => {
      opener.current = null;
    };
  }, []);

  const returnFocus = useCallback(() => {
    opener.current?.focus();
  }, []);

  return { headingRef, returnFocus };
}
