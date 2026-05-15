name: "Foundation — Pre-Bid AI Ad Verification (Scout)"
description: |

  Scaffold the monorepo and every cross-module typed contract from
  `features/architecture.md` so subsequent feature PRPs (gate logic, verifier
  agents, harness body, dashboard views) land independently against stable
  seams. **Foundation does not implement** verdict logic, the warm-path loop,
  agent prompts, or the browser-use page-capture body — each gets its own PRP.
  Output: a buildable empty system with zod-validated boundaries, in-memory
  store impls behind interfaces, typed-but-stubbed handlers, the
  agent→Lobster-Trap→Gemini wire, and ESLint enforcement that no module
  bypasses `@scout/llm-client`.

  Source spec: `features/architecture.md`. Read before starting.
  Pattern reference (carry conventions, NOT the code):
  `/home/hustlxai-1/business/vertex/products/dynamic-ad-exchange/` — pnpm
  workspaces, ESLint `no-restricted-imports`, zod at seams, no inline
  `process.env`, named exports, 300-line cap.

  ## Decisions (locked — overrideable in conversation, not silently)

  | # | Open question (architecture.md) | Locked answer |
  |---|---|---|
  | Q1 | Repo layout | pnpm workspaces monorepo, scope `@scout/*` |
  | Q2 | Hot-path runtime | Node 20 + Fastify ESM. **Gate PRP must run a 100-req synthetic before locking** (architecture doc says so); if P99 > 800ms, switch to Bun + Hono there. Foundation is runtime-agnostic outside `gate/`. |
  | Q3 | Queue / store | `ioredis` for queue + ProfileStore + cache; `better-sqlite3` for AuditStore. Both behind interfaces; in-memory impls for dev/tests. |
  | Q4 | browser-use deployment | Cloud API (`cloud.browser-use.com`). Self-host license check deferred to Harness PRP. |
  | Q5 | browser-use mode | Browser mode default via `browser-use-sdk/v2` `client.v2.browsers.*`. Agent-mode escape hatch is a follow-up. (npm README only documents Agent mode; Browser mode lives at `src/v2/resources/browsers.ts` in `github.com/browser-use/sdk`.) |
  | Q6 | Verifier fan-out | text + image + video + arbiter, each behind a `Verifier` interface. Cost trip-wire (drop video first) lands in Profiler PRP. |
  | Q7 | Lobster Trap policy file | `policies/lobstertrap.yaml`, in-repo, with `// Reason: DB-backed in prod` note. |
  | Q8 | Dashboard | Embed Lobster Trap's own UI (`http://localhost:8080/_lobstertrap/`) in an iframe + thin verdict viewer over AuditStore. Foundation creates the package shell only. |

  Reflect Q1–Q8 into `CLAUDE.md § Stack` per that file's update protocol.

  ## CLAUDE.md rules that bite

  - § Hard constraints — sub-second hot path; pre-bid; plug-and-play; both sponsor
    techs (Veea + Gemini) load-bearing for prizes.
  - § Working agreements — ask before scaffolding new packages or libs. **This PRP
    is the asking.** The decisions table is the contract.
  - 300-line cap, 1 happy / 1 edge / 1 failure per new file, no `VITE_*` secret.

  ## All Needed Context

  ```yaml
  - file: features/architecture.md
    why: Source spec. Every contract this PRP scaffolds is named in § Module
      boundaries or § Data shapes. Don't re-derive — implement what's there.

  - file: CLAUDE.md
    why: Hard constraints + working agreements. Cited above.

  - file: /home/hustlxai-1/business/vertex/products/dynamic-ad-exchange/.eslintrc.cjs
    why: Reference shape for `no-restricted-imports` (lines 56–86). Mirror the
      pattern; the new rules block `openai`/`@google/genai` outside @scout/llm-client.

  - file: /home/hustlxai-1/business/vertex/products/dynamic-ad-exchange/package.json
    why: Reference root scripts (typecheck, lint, format, test, build, audit,
      precommit). Engines node>=20, pnpm>=9. Use pnpm@10.x.

  - file: /home/hustlxai-1/business/vertex/products/dynamic-ad-exchange/CLAUDE.md
    why: § Project Structure / § TypeScript / § Testing — engineering conventions
      to mirror. Its hackathon constraints (≤$0.01, ≥50 tx) DO NOT apply here.

  - url: https://github.com/veeainc/lobstertrap
    why: README. Read § Quick start (the `--backend <url>` flag), § Configuration
      (YAML schema for `policies/lobstertrap.yaml`), and § Bidirectional metadata
      headers — the `_lobstertrap` request/response field is the wire that
      `@scout/llm-client.chat({...}, intent)` populates and parses. License: MIT.

  - url: https://ai.google.dev/gemini-api/docs/openai
    why: Confirmed verbatim. baseURL = "https://generativelanguage.googleapis.com/v1beta/openai/".
      Use `new OpenAI({ apiKey: GEMINI_API_KEY, baseURL })`. Vision, function
      calling, and structured output supported via the compat layer (beta).

  - url: https://github.com/openai/openai-node
    why: Official OpenAI Node SDK. Constructor takes `baseURL`, `apiKey`,
      `fetch`, `fetchOptions.dispatcher`. We use it as a typed HTTP client for
      the OpenAI chat-completions wire format that BOTH Lobster Trap (inbound)
      and Gemini's compat layer (outbound) speak. We never call OpenAI's
      servers and never need an OpenAI API key.

  - url: https://github.com/browser-use/sdk
    why: Node SDK source. Browser-mode resources at
      `browser-use-node/src/v2/resources/{browsers,sessions,profiles}.ts`. Env
      var `BROWSER_USE_API_KEY`. Foundation does NOT call these — Harness PRP does.

  - file: PRPs/wire-chatbox-to-seller-agent-server.md
    why: Density and shape reference for the per-module PRPs that follow.
  ```

  ## Why OpenAI SDK on a Gemini-track project

  Reads oddly; called out explicitly so the demo narrative is consistent:
  `@google/genai` has no `baseURL` knob, so it can't be pointed at Lobster Trap.
  Lobster Trap speaks the OpenAI chat-completions wire format inbound, and
  Gemini exposes the same wire format at its `/v1beta/openai/` compat endpoint.
  The OpenAI SDK is the cleanest typed client for that wire — it carries
  Bearer-auth, retries, vision-message helpers, and types. We never hit
  OpenAI infrastructure. The submission video frames it as: *"every agent call
  goes through Lobster Trap; the backend is Gemini."*

  ## Repo layout (after this PRP)

  ```
  package.json                            # workspace root, type: module
  pnpm-workspace.yaml                     # shared, store, policy, llm-client, harness, agents/*, profiler, gate, dashboard, scripts
  tsconfig.base.json                      # strict, NodeNext, ES2022
  .eslintrc.cjs                           # boundary overrides — see below
  vitest.config.ts                        # workspace-wide
  .env.example                            # every env var read by every config.ts
  shared/      @scout/shared              # zod schemas + interfaces (see "Contracts")
  store/       @scout/store               # ProfileStore (redis,memory), PolicyStore (file), AuditStore (sqlite,memory)
  policy/      @scout/policy              # YAML loader; match() is a STUB returning fixed shape
  llm-client/  @scout/llm-client          # OpenAI SDK → Lobster Trap → Gemini compat (REAL — see pseudocode)
  harness/     @scout/harness             # capturePage() is a STUB returning a valid PageCapture
  agents/{text,image,video}-verifier      # each STUB returning a valid AgentVerdict
  agents/arbiter                          # STUB returning a valid ArbiterDecision
  profiler/    @scout/profiler            # main() loop wired but bodies stubbed
  gate/        @scout/gate                # Fastify POST /verify, handler returns stub DENY
  dashboard/   @scout/dashboard           # Vite+React skeleton with Lobster Trap iframe
  policies/{lobstertrap.yaml, advertiser-default.yaml}
  lobstertrap/{install.sh, serve.sh, README.md}     # build & run the Go proxy
  scripts/     @scout/scripts             # seedPolicies, pingLobstertrap (validation gate L3)
  ```

  Files NOT created here: real verdict logic in `gate/src/handler.ts`; real
  `capturePage` body; verifier prompts; arbiter scoring; dashboard views beyond
  a skeleton. Each is a follow-up PRP.

  ## Contracts (`@scout/shared`)

  Implement every name in `features/architecture.md § Data shapes` plus the four
  module-boundary interfaces named in § Module boundaries. Split by concept under
  `shared/src/schemas/{bid,profile,policy,verdict,capture,job,intent}.ts` and
  `shared/src/interfaces/{store,verifier,harness,llmClient}.ts`. Specifics that
  the architecture doc doesn't pin:

  - `BidVerificationRequest.geo`: ISO-3166-1 alpha-2 (`/^[A-Z]{2}$/`).
  - `VerificationVerdict`: add `latencyMs: z.number().int().nonnegative()` and
    `lobstertrapTraceId: z.string().nullable()` (null when no LLM call this verdict).
  - `LobstertrapDeclaredIntent`: matches the `_lobstertrap` request schema in the
    Veea README — `declared_intent`, `agent_id`, optional `declared_paths`.
  - `LlmClient.chat(args, intent)` returns `{ content, lobstertrapTraceId, verdict, usage }`.
  - `LlmClient.healthcheck()` returns `{ ok: true, lobstertrapVersion } | { ok: false, reason }`.

  ## ESLint boundary overrides (load-bearing)

  Mirror `dynamic-ad-exchange/.eslintrc.cjs:56–86`. Add three overrides:

  1. **`openai` and `@google/genai` blocked everywhere except `llm-client/**`**
     and test files. Architecture doc § Where each sponsor tech lives: "no agent
     talks to Gemini directly … it has to be enforced as a build-time rule, not
     'we'll add it later.'"
  2. **`dashboard/`** — block `@scout/llm-client`, `@scout/store`, and any path
     matching `**/*secret*`.
  3. **`gate/`** — block `@scout/harness` and `@scout/profiler` (gate is hot
     path; harness is multi-second; gate consumes ProfileStore output, never
     calls warm-path code).

  Verify by adding a fixture file under `__eslint-smoke__/` that violates each
  rule, asserting `eslint .` exits non-zero, then deleting the fixture (one
  step per rule, in task order).

  ## Pseudocode (the only load-bearing wire)

  ```ts
  // llm-client/src/client.ts — every other module's only door to an LLM
  import OpenAI from "openai";
  import type { LlmClient } from "@scout/shared";
  import { llmConfig } from "./config.js";
  import { GEMINI_FLASH_MODEL } from "./models.js";
  import { LobstertrapResponseSchema } from "./lobstertrapSchema.js";

  export function createLlmClient(): LlmClient {
    const cfg = llmConfig();                        // GEMINI_API_KEY + LOBSTERTRAP_BASE_URL
    const oai = new OpenAI({
      apiKey: cfg.geminiApiKey,                     // Lobster Trap forwards Bearer untouched to Gemini compat
      baseURL: `${cfg.lobstertrapBaseUrl}/v1`,      // e.g. http://localhost:8080/v1
    });
    return {
      async chat({ messages, model = GEMINI_FLASH_MODEL, ...rest }, intent) {
        // Reason: Veea README "Bidirectional metadata headers" — the _lobstertrap
        // field is how DPI does declared-vs-detected mismatch detection. Standard
        // OpenAI clients ignore it, so it's safe to thread through.
        const res = await oai.chat.completions.create({
          model, messages, ...rest,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          _lobstertrap: intent as any,
        } as any);
        const trap = LobstertrapResponseSchema.parse((res as any)._lobstertrap);
        return {
          content: res.choices[0]?.message?.content ?? "",
          lobstertrapTraceId: trap.request_id,
          verdict: trap.verdict,
          usage: res.usage ?? null,
        };
      },
      async vision(args, intent) { /* same shape, vision messages */ },
      async healthcheck() { /* see healthcheck.ts; pings + asserts _lobstertrap present */ },
    };
  }
  ```

  All other handlers (`gate`, `profiler`, the four agents, `harness`) return
  hardcoded valid shapes that pass their own zod schemas. Do not invent logic.

  ## Gotchas

  - **Lobster Trap forwards `Authorization: Bearer ...` untouched.** So
    `llmConfig` exposes `GEMINI_API_KEY` as the OpenAI `apiKey`. Do NOT log
    bearer tokens at any tier. Lobster Trap's audit log records prompt content;
    flag in `lobstertrap/README.md` that PII handling on the audit store is a
    later concern.
  - **Gemini OpenAI compat is BETA.** Pin model IDs (`gemini-2.5-flash`,
    `gemini-2.5-pro`) in `llm-client/src/models.ts`. No `*-latest` aliases.
  - **`browser-use-sdk` Browser mode is undocumented in the npm README.** It
    exists at `src/v2/resources/browsers.ts` in `github.com/browser-use/sdk`.
    Foundation only stubs the harness; the Harness PRP must inspect that file
    (or the installed tarball) for current method names.
  - **ESM-only.** Root + every package `"type": "module"`. tsconfig
    `module: NodeNext`, `target: ES2022`. `better-sqlite3` is CJS — import as
    `import Database from "better-sqlite3"`.
  - **Lobster Trap is a Go binary built from source.** `lobstertrap/install.sh`
    clones `github.com/veeainc/lobstertrap` and runs `make build-static`. Demo
    machines need Go ≥ 1.22. Do NOT vendor the binary.
  - **`lobstertrap/serve.sh` MUST pass `--backend
    https://generativelanguage.googleapis.com/v1beta/openai`.** The default
    backend is Ollama; that would silently break the Gemini wire.
  - **Use `ioredis-mock` for unit tests.** CI does not need a real Redis.

  ## Task order (commit-sized)

  1. **Workspace + tooling** — root `package.json`, `pnpm-workspace.yaml`,
     `tsconfig.base.json`, `.eslintrc.cjs` (without boundary overrides yet),
     `.prettierrc`, `.nvmrc`, `vitest.config.ts`, empty `.env.example`. `pnpm
     install`. Verify `pnpm -r exec tsc --noEmit`.
  2. **`@scout/shared`** — schemas + interfaces + `constants.ts` + `env.ts` +
     `result.ts` + barrel. 1/1/1 tests per schema; full coverage on `env.ts`,
     `result.ts`. Verify `pnpm --filter @scout/shared test typecheck`.
  3. **ESLint boundary overrides** — add the three `no-restricted-imports`
     overrides. Verify by adding then removing one violating fixture per rule.
  4. **`@scout/store`** — interface impls (memory + redis + sqlite). Mock
     Redis with `ioredis-mock`; SQLite uses in-memory DB in tests. Contract
     test fixture runs the same suite against both impls.
  5. **`@scout/policy`** + **`@scout/llm-client`** + **`@scout/harness`** —
     `llm-client` is real (per pseudocode); `policy.match()` and
     `harness.capturePage()` are typed STUBs. 1/1/1 each. `vi.mock("openai")`
     in `llm-client` tests so no Gemini key needed.
  6. **`@scout/agent-{text,image,video}-verifier` + `@scout/agent-arbiter`** —
     each is a STUB returning a hardcoded valid `AgentVerdict` /
     `ArbiterDecision`. 1/1/1 schema-conformance per agent.
  7. **`@scout/profiler` + `@scout/gate`** — profiler `main()` round-trips one
     job through the in-memory queue, calls the stubbed pipeline, writes a
     stubbed `PageProfile`. Gate Fastify app: `POST /verify` returns the stub
     DENY. 1 happy (200 + verdict shape), 1 edge (400 with zod error on bad
     body), 1 failure (500, no stack leak).
  8. **`@scout/dashboard`** — Vite + React skeleton; `App.tsx` renders the
     Lobster Trap iframe + a verdict-panel placeholder. RTL test: renders +
     iframe `src` matches `VITE_LOBSTERTRAP_URL`.
  9. **`policies/`, `lobstertrap/`, `@scout/scripts`, `.env.example`,
     root `README.md`** — starter YAMLs (Lobster Trap policy follows the Veea
     README schema; advertiser policy has two example categories);
     `install.sh` + `serve.sh` per Gotchas; `seedPolicies` + `pingLobstertrap`
     scripts; `.env.example` lists every var read by every `config.ts`; root
     README documents the validation gates.
  10. **Update `CLAUDE.md § Stack`** with the locked Q1–Q8 (the doc's own
      update protocol requires this).
  11. **Full validation sweep** — gates below.

  ## Validation Gates (executable)

  ```bash
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r exec prettier --write .
  pnpm -r test
  pnpm -r build
  pnpm audit

  # Lobster Trap end-to-end smoke (requires GEMINI_API_KEY in env).
  ./lobstertrap/install.sh    # first-time only; needs Go >=1.22
  ./lobstertrap/serve.sh &
  LT_PID=$!
  sleep 1
  pnpm --filter @scout/scripts run pingLobstertrap
  # Expected: { ok: true, lobstertrapVersion: "<semver>" }
  kill $LT_PID
  ```

  Manual smoke (after gates pass): `pnpm dev:gate` → POST a valid
  `BidVerificationRequest` to `:3000/verify` → 200 + stub DENY shape.
  `pnpm dev:dashboard` with `pnpm dev:proxy` running → iframe loads.

  ## Final Checklist

  - [ ] All gates above are green.
  - [ ] Every package: `package.json` + `tsconfig.json` + `src/index.ts` barrel
        + at least one `.test.ts` (1/1/1).
  - [ ] No file > 300 lines.
  - [ ] No `process.env.*` outside a package's `config.ts`.
  - [ ] No secrets in `dashboard/`; no `VITE_*` secret.
  - [ ] Three ESLint boundary fixtures verified non-zero exit, then deleted.
  - [ ] `lobstertrap/serve.sh` always passes the Gemini-compat backend flag.
  - [ ] `LlmClient.chat` populates and parses `_lobstertrap`; `lobstertrapTraceId`
        threads through into `VerificationVerdict.lobstertrapTraceId`.
  - [ ] `CLAUDE.md § Stack` records the Q1–Q8 decisions.

  ## Out of Scope (file as follow-up PRPs)

  1. Gate verdict logic (profile lookup → policy match → optional Flash → fail-closed).
  2. Profiler real loop (queue consumer, parallel verifier fan-out, arbiter,
     profile commit, cost trip-wire from Q6).
  3. Harness real `capturePage` via `browser-use-sdk/v2` Browser mode.
  4. Verifier-agent prompts (text + image + video + arbiter — 4 PRPs).
  5. Policy `match()` rule evaluation.
  6. Dashboard views over AuditStore (iframe is just placeholder).
  7. Demo seeding (recorded bidstream replayer, pre-seeded pages).

  ## Anti-Patterns

  - ❌ Don't put real verdict logic in `gate/src/handler.ts` — that's the Gate PRP.
  - ❌ Don't import `openai` or `@google/genai` outside `@scout/llm-client`.
    Suppressing the ESLint rule defeats the Veea-Award architecture story.
  - ❌ Don't add `axios`/`node-fetch`/`undici`. OpenAI SDK uses native fetch.
  - ❌ Don't vendor the Lobster Trap binary; build via `install.sh`.
  - ❌ Don't pin `*-latest` Gemini aliases — they drift.
  - ❌ Don't add CI in this PRP. Gates run locally; CI is a later concern.
  - ❌ Don't break the 300-line cap to colocate schemas "for convenience" —
    split by concept.

  ## Confidence: 8 / 10

  Architecture doc is explicit; reference repo proves the convention; Lobster
  Trap + Gemini-compat + OpenAI-SDK chain is verified end-to-end against the
  README and the official compat docs. Stub bodies mean the first 8 tasks
  validate with `pnpm -r test` alone — no Gemini key, no Lobster Trap binary
  needed until task 9.

  Risks: (a) `browser-use-sdk` Browser-mode method names not in npm README —
  isolated to the Harness PRP since foundation stubs that body; (b) Gemini
  OpenAI compat is beta, so a feature regression there is `@scout/llm-client`'s
  single-point swap to `@google/genai`; (c) Q2 latency benchmark is deferred —
  if it fails, only `gate/` reshapes, every other package is runtime-agnostic.
