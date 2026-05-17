import { defineConfig } from "vitest/config";

// Bundle-grep config (PRP 04 Task 8). Walks `dist/` for forbidden
// secret strings AFTER `vite build`. Environment is `node` because we
// only read files; jsdom would be wasteful. ENOENT on missing `dist/`
// is the *failure* signal — do NOT skip on absence; that would hide
// a CI ordering bug where the bundle test runs before the build.
//
// Invoke via `pnpm test:bundle`. CI ordering:
//   pnpm --filter @scout/dashboard build
//   pnpm --filter @scout/dashboard test:bundle
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/__bundle__/**/*.test.ts"],
  },
});
