import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// CLAUDE.md § Working agreements: NO VITE_* env var holds a secret.
// Vite ships every VITE_* into the client bundle
// (https://vitejs.dev/guide/env-and-mode.html). This test walks `dist/`
// after `vite build` and asserts none of the three secret env-var
// names in the system today (D8) leak into the shipped bundle.
//
// Grows whenever a new secret env-var name lands. The list is
// duplicated in `.env.example` comments and `CLAUDE.md` — keep them in
// sync when adding a row.
//
// ENOENT on missing `dist/` is the *failure* signal: it means
// `pnpm build` did not run before `pnpm test:bundle`, which would
// silently let secrets ship.

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "../../dist");

const FORBIDDEN = ["GEMINI_API_KEY", "OPENAI_API_KEY", "LOBSTERTRAP_BEARER"];
const EXT = /\.(js|mjs|html|css)$/;

function* walk(dir: string): Iterable<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      yield* walk(p);
    } else if (EXT.test(p)) {
      yield p;
    }
  }
}

describe("dashboard bundle (post-`vite build`)", () => {
  it("contains no secret env-var strings (CLAUDE.md no-secrets-in-client)", () => {
    const offenders: string[] = [];
    for (const file of walk(dist)) {
      const content = readFileSync(file, "utf8");
      for (const key of FORBIDDEN) {
        if (content.includes(key)) {
          offenders.push(`${file}: ${key}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
