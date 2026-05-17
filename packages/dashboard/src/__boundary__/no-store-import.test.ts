import { describe, expect, it } from "vitest";

// PRP 04 Task 9 — boundary smoke. The foundation ESLint rule that
// blocks `@scout/store` (and `@scout/llm-client`) imports from
// `packages/dashboard/**` (`PRPs/foundation-ad-verification.md:155-156`)
// has not yet landed. Until it does, this test pins the boundary at
// the package-resolution layer instead: neither package is in
// `@scout/dashboard`'s `package.json` dependencies, so pnpm's isolated
// nodeLinker makes the runtime import unresolvable.
//
// `/* @vite-ignore */` is REQUIRED — without it Vite statically
// resolves the import string at transform time and fails the test
// file with a build error instead of a runtime rejection.
//
// When the foundation ESLint rule lands, replace this file with the
// shell-out variant the PRP describes (write a fixture file, run
// `eslint`, assert non-zero exit, delete the fixture in `finally`).

async function tryImport(name: string): Promise<unknown> {
  return import(/* @vite-ignore */ name);
}

describe("@scout/dashboard import boundary", () => {
  it("cannot resolve @scout/store at runtime (server-side reads live in @scout/dashboard-backend)", async () => {
    await expect(tryImport("@scout/store")).rejects.toThrow(
      /Cannot find package|Cannot find module|Failed to resolve|Failed to load/i,
    );
  });

  it("cannot resolve @scout/llm-client at runtime (no LLM keys in client bundle)", async () => {
    await expect(tryImport("@scout/llm-client")).rejects.toThrow(
      /Cannot find package|Cannot find module|Failed to resolve|Failed to load/i,
    );
  });
});
