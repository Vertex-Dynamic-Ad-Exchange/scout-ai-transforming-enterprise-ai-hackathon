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
