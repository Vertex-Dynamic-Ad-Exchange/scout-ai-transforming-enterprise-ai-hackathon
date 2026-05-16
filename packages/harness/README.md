# @scout/harness

Cloud-driven page capture for the AI Ad Verification System. Renders a URL
once (in a real browser, via the configured geo proxy) and returns a
typed `PageCapture` for the verifier cluster to score.

## Overview

One public surface:

```ts
import { createHarness } from "@scout/harness";

const harness = createHarness();
const capture = await harness.capturePage(url, opts);
// capture: PageCapture (@scout/shared/schemas/capture)
```

Spec: [`features/clusterB/harness-capture-page.md`](../../features/clusterB/harness-capture-page.md).
Contracts (`PageCapture`, `CaptureOptions`, `Harness`, `HarnessError`,
`HarnessException`) live in [`@scout/shared`](../shared/src/) — both packages
share one source of truth.

## Env vars

| Var                    | Required | Source      | Notes                                             |
| ---------------------- | -------- | ----------- | ------------------------------------------------- |
| `BROWSER_USE_API_KEY`  | yes      | `config.ts` | Cloud-mode key. Single read site. Never logged.   |
| `BROWSER_USE_BASE_URL` | no       | `config.ts` | Override for self-host; defaults to vendor Cloud. |

`src/config.ts` is the **only** file allowed to touch `process.env.*` in this
package (audit grep: `grep -rn 'process\.env' packages/harness/src` returns
exactly that one file).

## Cloud vs self-host

`browser-use` core is MIT-licensed (verified 2026-05-15:
<https://github.com/browser-use/browser-use/blob/main/LICENSE>). For the
hackathon demo we use the vendor Cloud (foundation Q4 —
[`PRPs/foundation-ad-verification.md:27`](../../PRPs/foundation-ad-verification.md)).
Productionization story is **lift-and-shift to self-host**: point the SDK at
a locally-served instance via `BROWSER_USE_BASE_URL`. Self-host install /
serve scripts are a follow-up PRP (out of scope here).

## Agent-mode sponsor-tech exception (the agreed bypass)

`captureViaAgent` (in `src/agentMode.ts`) calls
`client.tasks.create({...})`, which triggers a browser-use **vendor-internal
LLM loop**. That LLM is the vendor's, not ours, and the SDK exposes no
`baseURL` knob for it — so it does **not** route through Veea Lobster Trap.

This is the agreed exception per
[`features/clusterB/harness-capture-page.md:109`](../../features/clusterB/harness-capture-page.md).
All other LLM calls in the system (verifiers, arbiter, gate Flash
escalation) DO route through Lobster Trap via `@scout/llm-client`.

Mitigations (all enforced in tests):

- **Prompt is a fixed string we control** — `AGENT_TASK_PROMPT` in
  `src/agentMode.ts`. Only `${url}` is interpolated; the test regex pin
  (T3c in `agentMode.test.ts`) fails the build if a second template variable
  is introduced.
- **Off-origin links are forbidden in the prompt** — second layer in case
  the URL itself carries an injection payload.
- **`keepAlive: false` + `persistMemory: false`** on every `sessions.create`
  — bounds blast radius to a single task; no cross-advertiser memory leak.
- **Structured output via JSON Schema** — the vendor LLM is constrained to
  `AGENT_OUTPUT_JSON_SCHEMA`; we re-validate with zod's `safeParse` on
  return (defense in depth).

The README itself is part of the guardrail: any refactor that wants to
delete the exception must first delete this paragraph, which the reviewer
will catch.

## Two-pass behavior (`src/capture.ts`)

```
       opts.forceAgentMode === true
                  │
                  ▼
              captureViaAgent  ──► PageCapture { mode: "agent" }
                                   (no fallback warning)

       opts.forceAgentMode !== true
                  │
                  ▼
       ┌─── captureViaBrowser ───► PageCapture { mode: "browser" }
       │            │
       │            ▼ throws HarnessException
       │     code ∈ { BLOCKED, CONSENT_WALL_UNRESOLVED } ?
       │            │
       │   no ──► re-throw (TIMEOUT / NAVIGATION_FAILED / UPSTREAM_DOWN)
       │            │
       │   yes ─► captureViaAgent ─► PageCapture { mode: "agent" } +
       │                              warnings.push(
       │                                "consent_wall_handled_via_agent_mode"
       │                              )
       │            │
       │            ▼ also throws
       │     re-throw the **Agent-mode** error (Browser error is dropped)
```

- **`TIMEOUT` does NOT retry** — re-trying via Agent would compound the
  latency cost (Agent budget is ~5–10× Browser).
- **`NAVIGATION_FAILED` does NOT retry** — would push a malformed URL or
  unsupported content-type into a second cloud session.
- **Soft latency targets**: Browser P95 ≤ 8 s; Agent P95 ≤ 30 s. Hard cap
  is `opts.timeoutMs` (per-call).

Warning string `"consent_wall_handled_via_agent_mode"` is observed by the
profiler — **rename only with coordination**.

## Smoke script

```sh
BROWSER_USE_API_KEY=... pnpm --filter @scout/harness run smoke
BROWSER_USE_API_KEY=... pnpm --filter @scout/harness run smoke -- --force-agent
```

Four URLs, hardcoded in `scripts/smoke-capture.ts`:

| #   | URL                                  | Expected mode | Expected signal                                      |
| --- | ------------------------------------ | ------------- | ---------------------------------------------------- |
| 1   | `en.wikipedia.org/wiki/Page_caching` | `browser`     | static article; no warnings                          |
| 2   | `news.ycombinator.com`               | `browser`     | SPA; no `<video>`                                    |
| 3   | `www.bbc.com/news`                   | `browser`     | video-heavy; ≥1 video sample                         |
| 4   | `www.theguardian.com`                | `agent`       | `warnings ⊇ ["consent_wall_handled_via_agent_mode"]` |

**Required to run at least once before May 18–19 onsite.** The smoke is
the only live exercise of the two-pass orchestrator; unit tests stub the
vendor SDK.

## `AbortSignal` finding (PRP-B2 Task 12)

The browser-use SDK (`@3.6.0`) does **not** accept `AbortSignal` on
`browsers.create()` or `tasks.wait()`. Both modes use the **`Promise.race` + `settled`-flag** pattern (Path B) instead. See `src/browserMode.ts` lines
~84 and `src/agentMode.ts` lines ~137 for the canonical shape, including
late-resolve orphan cleanup (a session that arrives after we threw
`TIMEOUT` is stopped to avoid the money leak).

If a future SDK release adds AbortSignal, switch back to Path A and delete
the wrapper — it's a workaround, not the desired shape.

## Playwright Chromium download

`pnpm install` auto-fetches a Chromium binary (~300 MB) for the
`playwright` package. CI may skip with
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` — Browser mode connects to the
Cloud-provisioned browser over CDP, so no local Chromium is required to
run captures.

## Security summary

1. `BROWSER_USE_API_KEY` is only read in `config.ts`; never logged.
2. Fresh `sessions.create` per `capturePage` — no pooling.
3. Geo-proxy fidelity: a silent US fallback on unavailable proxy is
   forbidden. Throw `UPSTREAM_DOWN` instead.
4. Off-origin links: not followed (Browser mode never clicks; Agent prompt
   forbids).
5. `domText` is untrusted page content. Never log full `PageCapture` —
   verifiers in Cluster C treat it as data, not instructions, and the
   Lobster Trap policy seam enforces that at the LLM call site.

## Out of scope (v1)

- Mobile-viewport capture
- Multi-region capture (one geo per call)
- PDF rendering (we throw `NAVIGATION_FAILED` on `application/pdf`)
- S3/GCS evidence store (captures live in `tmpdir` until the profiler
  rehomes them)
- Perceptual hashing
- Concurrent capture (the profiler owns concurrency)
- Self-host install / serve scripts

## SDK shape correction

`browser-use-sdk@3.6.0` exposes a **flat** resource surface:
`client.browsers.*`, `client.sessions.*`, `client.tasks.*`. References to
`client.v2.*` in
[`features/clusterB/harness-capture-page.md:48`](../../features/clusterB/harness-capture-page.md)
and `PRPs/foundation-ad-verification.md:28, 217-219` are superseded by the
actual SDK surface used here.
