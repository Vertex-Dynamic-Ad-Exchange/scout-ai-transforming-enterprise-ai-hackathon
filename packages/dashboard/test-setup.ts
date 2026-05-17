// Augments vitest's `expect` with @testing-library/jest-dom matchers
// (`toBeInTheDocument`, `toHaveAttribute`, etc.) — explicit /vitest
// entry, not the bare import, so we don't drag in jest-only globals.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest doesn't auto-cleanup RTL DOM between tests when globals:false.
afterEach(() => {
  cleanup();
});

// jsdom returns 0 for `offsetWidth` / `offsetHeight` because there is no
// real layout engine. `@tanstack/react-virtual` measures the scroll
// container via `getRect → offsetWidth/Height` (virtual-core
// observeElementRect.ts) — a 0×0 container yields an empty visible
// range, so no rows render even when `count` is correct. Override the
// prototype getters to parse an explicit `style="height: Npx"` (the
// only shape the timeline scroller and inner sizer use) and fall back
// to 0 otherwise so we don't accidentally claim space for elements
// that never declared any. Real browsers obviously don't need this.
function readPixelStyle(value: string): number {
  const px = parseFloat(value);
  return Number.isFinite(px) ? px : 0;
}
Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get(): number {
    return readPixelStyle((this as HTMLElement).style.height);
  },
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get(): number {
    return readPixelStyle((this as HTMLElement).style.width);
  },
});

// `@tanstack/react-virtual` will use a ResizeObserver if one exists. In
// jsdom it doesn't, and the library falls back to a one-shot
// `offsetWidth/Height` measurement (handled above). Provide a no-op
// constructor so production code that imports `new ResizeObserver(...)`
// for *other* reasons doesn't throw.
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: NoopResizeObserver,
  });
}
