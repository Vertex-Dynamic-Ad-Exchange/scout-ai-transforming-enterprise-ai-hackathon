# `@scout/dashboard`

Read-only governance UI for the AI ad verification system. Vite + React
SPA that talks to `@scout/dashboard-backend` over HTTP and embeds the
Veea Lobster Trap dashboard in an iframe (the Track-1 demo showpiece).

See `features/clusterD/dashboard-verdict-views.md` for the full spec
and `PRPs/clusterD/dashboard-verdict-views/` for the per-PRP slice.

## Commands

```bash
pnpm --filter @scout/dashboard dev          # vite dev server :5173
pnpm --filter @scout/dashboard build        # tsc + vite build → dist/
pnpm --filter @scout/dashboard test         # vitest run (jsdom, excludes __bundle__)
pnpm --filter @scout/dashboard test:bundle  # vitest run (node) over dist/, requires prior build
pnpm --filter @scout/dashboard typecheck    # tsc --noEmit
```

## CI / pre-commit ordering (load-bearing)

The bundle-grep secrets gate (`src/__bundle__/no-secrets.test.ts`)
walks `dist/` for forbidden secret env-var names. It MUST run **after**
`pnpm build` — ENOENT on missing `dist/` is the _failure_ signal (PRP
04 Task 8). The default `pnpm test` excludes it so dev runs don't fail
just because the dev hasn't rebuilt. The CI sequence is:

```bash
pnpm --filter @scout/dashboard build
pnpm --filter @scout/dashboard test
pnpm --filter @scout/dashboard test:bundle
```

If `build` fails, abort the pipeline before `test:bundle` runs;
otherwise the bundle gate goes silent (PRP 04 § Confidence).

## Env vars (every `VITE_*` ships to the client bundle)

| Var                          | Purpose                                     | Secret? |
| ---------------------------- | ------------------------------------------- | ------- |
| `VITE_LOBSTERTRAP_URL`       | iframe `src` for the Lobster Trap dashboard | no      |
| `VITE_DASHBOARD_BACKEND_URL` | base URL of `@scout/dashboard-backend`      | no      |
| `VITE_DEMO_ADVERTISER_ID`    | stub-auth session ID for `x-advertiser-id`  | no      |

**No `VITE_*` may hold a secret** (CLAUDE.md § Working agreements). The
bundle-grep test pins this for `GEMINI_API_KEY`, `OPENAI_API_KEY`, and
`LOBSTERTRAP_BEARER`. Add new names to the `FORBIDDEN` list in
`src/__bundle__/no-secrets.test.ts` when introducing new server-side
secret env-vars.
