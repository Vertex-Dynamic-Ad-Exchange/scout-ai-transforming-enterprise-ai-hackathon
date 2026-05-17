import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `environment: "jsdom"` so RTL has a DOM. `setupFiles` augments
// vitest's `expect` with @testing-library/jest-dom matchers (see
// test-setup.ts).
//
// `src/__bundle__/` is EXCLUDED from the default `pnpm test` run —
// the bundle-grep test (PRP 04 Task 8) requires `vite build` to have
// produced `dist/` and ENOENT on missing `dist/` is the *failure*
// signal per the PRP. A normal dev `pnpm test` shouldn't fail just
// because the developer hasn't run a build yet. CI runs the bundle
// gate via `pnpm test:bundle` after `pnpm build`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "src/__bundle__/**"],
  },
});
