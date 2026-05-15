name: "Harness — PRP-B2: Browser-mode `capturePage` orchestrator (TDD)"
description: |

  Third of four PRPs for `features/clusterB/harness-capture-page.md`. Wires
  the five pure helpers from PRP-B1 into the real `capturePage(url, opts) →
  PageCapture` body via `browser-use-sdk@^3.6.0` Cloud + Playwright over
  the returned CDP URL. **Browser mode only** — Agent-mode escape hatch +
  two-pass fallback land in PRP-C.

  **Prereqs**: PRP-A (`harness-contracts.md`) + PRP-B1
  (`harness-browser-helpers.md`) merged.

  ## TDD discipline

  Every task is **red → green → refactor**. Run the test, confirm it
  fails for the *expected reason*, then write minimum impl. Commit at
  green. `vi.mock` for `browser-use-sdk` and `playwright` is introduced
  per-test, not as a shared mock module.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A directly; Task 13 pins the hot-path
    boundary via an ESLint smoke
    (`PRPs/foundation-ad-verification.md:157-159`).
  - **Pre-bid** — Boundary preserved by Task 13.
  - **Plug-and-play** — `createHarness()` returns a `Harness`-typed
    object; PRP-A locked the interface.
  - **Sponsor tech** — Neither originates here. Lobster Trap seam
    preserved by *not introducing* an LLM call.

  ## CLAUDE.md rules that bite

  - TypeScript strict, NodeNext, ES2022, ESM-only.
  - 300-line file cap. `browserMode.ts` is the biggest; extract a
    sibling `screenshots.ts` if it approaches 200.
  - Dep approval covered by PRP-B1 Task 1 (no re-asking).

  ## Decisions (locked here)

  | # | Question | Locked answer |
  |---|---|---|
  | D1 | Screenshot strategy | Above-fold + `sampleScrolls` viewport-scroll samples (default 2 → 3 total). |
  | D2 | Video sampling | Poster + first-second frame per `<video>`; if frame-extraction flakes, fall back to poster-only + `warnings: ["video_first_second_frame_unavailable"]`. |
  | D3 | `timeoutMs` → SDK `timeout` | `Math.max(1, Math.ceil(opts.timeoutMs / 60_000))`. SDK unit is **MINUTES**, max 240. |
  | D4 | Consent-wall detection | Stub returning `false` in this PRP. PRP-C wires real detection + Agent-mode fallback together. |
  | D5 | `forceAgentMode: true` (Browser side) | Throws `HarnessException(NAVIGATION_FAILED, "forceAgentMode requires PRP-C")`. PRP-C replaces this branch. |
  | D6 | `AbortSignal` through SDK | Verify in Task 12. If respected → pass `signal`. If not → `Promise.race([sdkCall, timeoutReject])` + explicit `sdk.browsers.stop()` in `.finally()`. Record finding in PR description. |

  ## Critical SDK reality — verified upstream 2026-05-15

  The feature file (`features/clusterB/harness-capture-page.md:48`) and
  foundation PRP reference `client.v2.browsers.create()`. **That path
  does not exist in `browser-use-sdk@3.6.0`.** Verified shape:

  ```ts
  import { BrowserUse } from "browser-use-sdk";              // flat, no .v2.*
  const sdk = new BrowserUse({ apiKey: cfg.browserUseApiKey });
  const session = await sdk.browsers.create({
    proxyCountryCode: "us",     // alpha-2 LOWERCASE — SDK auto-lowercases input
    timeout: 60,                 // MINUTES (max 240, NOT ms)
    browserScreenWidth: 1280, browserScreenHeight: 800,
    allowResizing: false, enableRecording: false,
  });
  // session: { id, status, cdpUrl?, liveUrl?, timeoutAt, startedAt, ... }

  import { chromium } from "playwright";
  const browser = await chromium.connectOverCDP(session.cdpUrl!);
  const page = await (browser.contexts()[0] ?? await browser.newContext()).newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: msFromOpts });
  ```

  Implications: SDK provisions remote Chrome → returns CDP URL → Playwright
  drives. `proxyCountryCode` auto-lowercased; output `geo` stays UPPERCASE.
  429 enforced server-side (smoke runs sequentially).

  ## All Needed Context

  ```yaml
  - file: PRPs/harness-contracts.md
    why: Prereq A — @scout/shared types.

  - file: PRPs/harness-browser-helpers.md
    why: Prereq B1 — config, hash, extract, errors, storage helpers
      this PRP wires together.

  - file: features/clusterB/harness-capture-page.md
    section: "FEATURE (lines 11-71); EXAMPLES (lines 73-92); Security
      guardrails (lines 151-158); Gotchas (lines 160-170); Test order
      (lines 183-195)"
    why: Source spec. Test matrix below maps 1:1 to lines 54-69.

  - file: PRPs/foundation-ad-verification.md
    section: "ESLint boundary rules (lines 147-159) — Task 13 fixture.
      Factory pattern (lines 115-203) — createHarness mirrors createLlmClient."
    why: Pattern + boundary precedent.

  - url: https://github.com/browser-use/sdk/blob/main/browser-use-node/src/v2/resources/browsers.ts
    why: Verified Browsers.create() signature.

  - url: https://github.com/browser-use/sdk/blob/main/browser-use-node/src/v2/client.ts
    why: BrowserUse class — flat surface; apiKey explicit-pass.

  - url: https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
    why: chromium.connectOverCDP — SDK → drivable-page bridge.

  - url: https://playwright.dev/docs/api/class-page#page-goto
    why: goto(url, { waitUntil, timeout }). networkidle for content pages.

  - url: https://vitest.dev/api/vi.html#vi-mock
    why: vi.mock("browser-use-sdk") + vi.mock("playwright") per-test.

  - url: https://vitest.dev/api/#test-each
    why: Table-driven matrix for screenshot-count + timeout conversion.
  ```

  ## Files

  ```
  packages/harness/src/
    factory.ts                + __tests__/factory.test.ts
    browserMode.ts            + __tests__/browserMode.test.ts
                                + __tests__/browserMode.abort.test.ts
    screenshots.ts            + __tests__/screenshots.test.ts        (extract if browserMode.ts >200 lines)
    index.ts                  (REWRITTEN — barrel)
  packages/harness/scripts/
    smoke-capture.ts          (manual, not in CI)
  packages/gate/__eslint-smoke__/
    imports-harness.ts        (TEMP fixture — added + deleted in Task 13)
  packages/harness/package.json (add `smoke` script)
  ```

  ## Task order (TDD)

  ### Task 1 — `factory.ts` + `factory.test.ts`

  Red. Test: `satisfies Harness` compile-check; missing-key throw;
  happy-path construction returns object with `capturePage` method.
  Green: write `factory.ts` mirroring
  `PRPs/foundation-ad-verification.md:175-202` (LlmClient pattern). Stub
  `browserMode.capturePage` with
  `throw new Error("PRP-B2 Task 2");` so this task lands green.

  ```ts
  // factory.ts
  import { BrowserUse } from "browser-use-sdk";
  import type { Harness } from "@scout/shared";
  import { harnessConfig } from "./config.js";
  import { capturePage } from "./browserMode.js";

  export function createHarness(): Harness {
    const cfg = harnessConfig();
    const sdk = new BrowserUse({ apiKey: cfg.browserUseApiKey, baseUrl: cfg.browserUseBaseUrl });
    return { capturePage: (url, opts) => capturePage(sdk, cfg, url, opts) } satisfies Harness;
  }
  ```

  ### Task 2 — Browser-mode happy path (no video)

  Red. `browserMode.test.ts` happy block: `vi.mock("browser-use-sdk")` →
  `.browsers.create()` resolves with `{ id: "sess-1", cdpUrl: "ws://fake",
  ... }`. `vi.mock("playwright")` → `chromium.connectOverCDP` returns a
  fake `browser` with `contexts()` / `newPage()`. Fake `page` stubs
  `goto`/`evaluate`/`screenshot`/`url`/`$$eval`/`waitForTimeout`. Drive
  `createHarness().capturePage("https://example.test/article")`. Assert:

  - `result.capturedBy.mode === "browser"`
  - `result.capturedBy.sdkVersion === "browser-use-sdk@3.6.0"`
  - `result.screenshots.length === 3` (above-fold + 2 scrolls default)
  - `result.videoSamples.length === 0`
  - `result.domText` non-empty
  - `result.contentHash` matches `/^[a-f0-9]{64}$/`
  - `result.warnings === []`
  - `sdk.browsers.stop("sess-1")` called exactly once
  - `sdk.browsers.create` called with `proxyCountryCode: "us"` default

  Green. Write `browserMode.ts`. The pipeline:

  1. `CaptureOptionsSchema.parse(opts ?? {})` — fail-fast.
  2. If `forceAgentMode` → throw per D5.
  3. URL guard — must be http(s); else `NAVIGATION_FAILED`.
  4. Convert timeout per D3; set `AbortController` + `setTimeout`.
  5. `sdk.browsers.create({ proxyCountryCode: geo, timeout: minutes,
     browserScreenWidth, browserScreenHeight, allowResizing: false,
     enableRecording: false })` — capture `sessionId`.
  6. `chromium.connectOverCDP(session.cdpUrl)`; reuse `contexts()[0]`.
  7. `page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs })`.
     If `!resp` → `NAVIGATION_FAILED`; if `!resp.ok()` → `BLOCKED`.
  8. Content-Type guard: `application/pdf` → `NAVIGATION_FAILED`.
  9. `detectConsentWall(page)` stub returns `false` (D4).
  10. `page.evaluate("document.body?.innerText ?? \"\"")` →
      `canonicalDomText` → truncate via `MAX_DOM_TEXT_BYTES`; push
      `dom_text_truncated` warning if cut.
  11. `pickHeadline(page)` + `extractMetadata(page)` — new DOM-side
      helpers (sibling `domExtract.ts` or inline; need Playwright Page).
      Volatile-DOM strip-list (`time[datetime]`,
      `[data-testid="ad-slot-*"]`, `meta[name="csrf-token"]`) runs
      inside `page.evaluate` BEFORE `innerText` so the strip is data,
      not Node code. Document in code: keep selectors as a static array.
  12. Above-fold screenshot via `writeScreenshot(baseDir,
      STORAGE_PLACEHOLDER, 0, bytes, ...)`. Loop `i = 1..sampleScrolls`:
      `page.evaluate((h) => window.scrollBy(0, h), viewport.h)`,
      `page.waitForTimeout(150)`, screenshot, push.
  13. Video: `captureVideo: false` → `videoSamples: []` +
      `warnings: ["video_skipped_by_option"]`. Else
      `page.$$eval("video", ...)` for poster + first-second-frame.
  14. `computeContentHash(domText, screenshots.map(s => s.bytes))`.
      Rename placeholder dir → `{contentHash}` dir; rewrite URIs via
      `rehomeUri`.
  15. Build `result`. Run `PageCaptureSchema.safeParse(result)`. On
      failure: throw `UPSTREAM_DOWN` with **issue path only** (no value
      — 256 KiB PII risk).
  16. `try { ... } catch (e) { throw e instanceof HarnessException ? e : new HarnessException(classifySdkError(e), String(e.message ?? e), e); }`
  17. `finally`: `clearTimeout(tm)`; `try { browser?.close(); } catch {}`;
      `try { if (sessionId) await sdk.browsers.stop(sessionId); } catch {}`.

  Constants near top: `SDK_VERSION = "browser-use-sdk@3.6.0"`,
  `BROWSER_DEFAULT_TIMEOUT_MS = 15_000`, `VIEWPORT_DEFAULT = { w: 1280,
  h: 800 }`.

  If `browserMode.ts` approaches 200 lines, extract `screenshots.ts`.

  ### Task 3 — Video happy path

  Red: `$$eval("video", ...)` mock returns `[{ src, poster, durationMs:
  2500 }]`. Assert `videoSamples.length === 2`; first kind `"poster"`;
  second `"first_second_frame"` at `timestampMs: 1000`.

  Green: implement `downloadBytes(url, signal)` via native `fetch`.
  `captureVideoFrame(page, src, ts, signal)` is harder — either (a)
  inject offscreen `<video>` + `canvas` via `page.evaluate` and grab a
  JPEG, or (b) fall back to poster-only + `warnings:
  ["video_first_second_frame_unavailable"]`. **Pick (b) if (a) flakes
  in the smoke** — bounded scope; file (a) as follow-up. Adjust test
  if (b).

  ### Task 4 — `captureVideo: false`

  Red+Green: pin the warning string `"video_skipped_by_option"` verbatim
  — the profiler's Q6 cost trip-wire reads it.

  ### Task 5 — `sampleScrolls` matrix

  `test.each` over `{0, 1, 2, 5}` → `screenshots.length = {1, 2, 3, 6}`,
  `scrollY` strictly increasing. Bounds the verifier batch size.

  ### Task 6 — `contentHash` determinism

  Capture the same mock-fixture twice in one test. Assert identical
  64-char hex; pin the expected value as a test constant. A regression
  here invalidates every cached PageProfile in production.

  ### Task 7 — Volatile-noise insensitivity

  Two captures of a fixture whose `innerText` includes
  `"Last updated: 2026-05-15T10:00:00Z"` vs `"...:01Z"`. With the
  strip-list in place (Task 2 step 11), hashes identical. If you can't
  strip without breaking other tests, mark `it.todo` with explicit
  rationale and file a follow-up — **do NOT silently disable**.

  ### Task 8 — `domText` truncation boundary

  255 KiB DOM → no warning. 257 KiB → `Buffer.byteLength(result.domText,
  "utf8") === 256 * 1024` AND `warnings: ["dom_text_truncated"]`. Assert
  via `Buffer.byteLength`, not `.length` (UTF-16 char-count ≠ UTF-8
  byte-count).

  ### Task 9 — Post-redirect URL vs requested URL

  Mock `page.url()` to return `https://example.test/b` after
  `goto("http://example.test/a")`. Assert:
  - `requestedUrl === "http://example.test/a"`
  - `url === "https://example.test/b"`

  Cache callers use `requestedUrl`; verifiers see `url`. Silent
  cache-poisoning bug if mixed.

  ### Task 10 — Geo-proxy passthrough

  `opts.geo: "DE"` → `sdk.browsers.create` mock receives
  `proxyCountryCode: "de"` (SDK lowercases). Output `result.geo ===
  "DE"`. Pinned via spy. Silent US fallback = brand-safety bug.

  ### Task 11 — `timeoutMs` → minutes conversion (D3)

  Table-driven `test.each`:

  | `opts.timeoutMs` | Expected SDK `timeout` (minutes) |
  |---|---|
  | 100         | 1 (min-1 clamp) |
  | 60_000      | 1 |
  | 120_000     | 2 |
  | 600_000     | 10 |
  | 13_000_000  | 217 |

  Spy on `sdk.browsers.create`.

  ### Task 12 — AbortSignal experiment (D6)

  Red: `browserMode.abort.test.ts`. Mock `sdk.browsers.create` to take
  ~500ms. Drive `capturePage(url, { timeoutMs: 100 })`. Assert throws
  `HarnessError.TIMEOUT` within ~150ms (50ms slack), AND no leaked
  promise after rejection: register `process.on("unhandledRejection")`
  spy at test start; assert zero calls after a 50ms microtask drain.

  Green path A — SDK respects `AbortSignal`: pass `{ signal: abort.signal }`
  to the SDK call. Read `src/core/http.ts` upstream to verify the
  parameter shape.

  Green path B — SDK does NOT respect `AbortSignal`: wrap in
  `Promise.race([sdkCall, new Promise<never>((_, rj) => setTimeout(() =>
  rj(new HarnessException(HarnessError.TIMEOUT, "browser create
  timeout")), timeoutMs))])` AND attempt `sdk.browsers.stop()` in
  `.finally()` if a `sessionId` was captured before throw.

  Either green is acceptable. **Silently shipping without the experiment
  is not.** Record finding in PR description.

  ### Task 13 — Hot-path boundary preservation (ESLint)

  Add `packages/gate/__eslint-smoke__/imports-harness.ts`:

  ```ts
  import { createHarness } from "@scout/harness";
  void createHarness;
  ```

  Run `pnpm --filter @scout/gate exec eslint __eslint-smoke__/imports-harness.ts`.
  Expected: non-zero exit. If zero → **stop and surface to human**
  (foundation rule at `PRPs/foundation-ad-verification.md:157-159` isn't
  installed). Delete the fixture after asserting.

  ### Task 14 — Schema-conformance regression

  Make `sdk.browsers.create` mock return `{ ..., cdpUrl: "" }`. The
  downstream chain produces a result that fails
  `PageCaptureSchema.safeParse`. Assert: throws `UPSTREAM_DOWN`; message
  matches `/^harness produced invalid PageCapture at path: [\w.]+$/` —
  **issue path only**, never the value.

  ### Task 15 — `index.ts` barrel

  ```ts
  export { createHarness } from "./factory.js";
  export type { HarnessConfig } from "./config.js";
  export { HarnessError, HarnessException } from "@scout/shared";
  // capturePage is internal; consumers go through createHarness().
  ```

  No new test — alignment pinned by `factory.test.ts`'s `satisfies
  Harness`.

  ### Task 16 — Smoke script

  `packages/harness/scripts/smoke-capture.ts`. Three hardcoded URLs
  (in source, NOT CLI args — locks the captured set): a static
  article, an SPA, a video-heavy page. Drives `createHarness().capturePage(url)`
  SEQUENTIALLY (concurrency is profiler's domain). Prints one line per
  capture: `{ mode, timeMs, screenshotCount, videoCount, contentHash,
  warnings }`. Add to `package.json`:

  ```json
  "scripts": { "smoke": "tsx scripts/smoke-capture.ts" }
  ```

  Outside `__tests__/` so `vitest` ignores it. **Run live at least once
  before declaring done.**

  ### Task 17 — Full validation sweep

  ```bash
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r exec prettier --write .
  pnpm -r test
  pnpm -r build
  pnpm audit
  # Manual (requires BROWSER_USE_API_KEY):
  pnpm --filter @scout/harness run smoke
  ```

  Also re-verify the env-isolation invariant:

  ```bash
  grep -rn 'process\.env' packages/harness/src
  # Expected: ONLY config.ts lines.
  ```

  ## Security guardrails

  - `BROWSER_USE_API_KEY` only in `config.ts` (PRP-B1 pinned this). The
    factory passes `apiKey` explicitly — never relies on SDK's
    `process.env` fallback.
  - Never log full `PageCapture` — `domText` up to 256 KiB of arbitrary
    page content. Log `{ url, contentHash, mode, elapsedMs, warnings }`.
  - `safeParse` (not `parse`) at exit — error message is path string
    only; never echoes the value.
  - Orphan cleanup: every SDK call wrapped in `try { ... } finally { sdk.browsers.stop(sessionId); }`.
    Tests T2 (happy), T12 (abort), T14 (throw mid-flow) pin this.
  - Geo-proxy fidelity: silent US fallback is a brand-safety bug. Task
    10 pins the happy path; on `proxyCountryCode: "de"` 4xx response,
    throw `UPSTREAM_DOWN` (do NOT retry without proxy).
  - No session pooling. Each `capturePage` = fresh session. Pooling is
    a cross-advertiser leak vector.
  - No off-origin link follow. Browser mode only does `goto` +
    `scrollBy` — never `page.click()` arbitrary links.

  ## Out of scope (PRP-C)

  - `agentMode.ts` + `sdk.tasks.create`.
  - Two-pass Browser → Agent fallback (D4 + D5 stubs replaced in PRP-C).
  - Real consent-wall detection.
  - `packages/harness/README.md`.
  - CLAUDE.md § Stack updates.
  - Vendor-LLM sponsor-tech exception documentation.

  ## Anti-Patterns

  - ❌ Skip Task 12. Cloud sessions accrue cost; orphans on timeout =
    money leak.
  - ❌ Trust the SDK's `process.env.BROWSER_USE_API_KEY` fallback.
  - ❌ Add `axios` / `node-fetch` / `undici`. Native `fetch` is enough.
  - ❌ Substitute Puppeteer for Playwright (D1 in PRP-B1 was locked).
  - ❌ Session pool / cookie reuse. Tenancy leak.
  - ❌ Echo `BROWSER_USE_API_KEY` in any error or log.
  - ❌ Log full `PageCapture`. Structured summaries only.
  - ❌ `JSON.stringify(result)` in error messages — PII leak.
  - ❌ Break the 300-line cap on `browserMode.ts`. Extract before 200.
  - ❌ Pin `*-latest` versions. Exact-minor only.
  - ❌ Ship without running the smoke live.

  ## Confidence: 7 / 10

  Strengths: SDK source read-verified; helpers green from PRP-B1;
  factory pattern mirrors `@scout/llm-client`.

  Risks:
  - **R1 — Task 12 outcome unverified.** AbortSignal experiment may
    land path B, changing the mock setup for T2's orphan-cleanup
    assertion. Adapt T2 after Task 12.
  - **R2 — Playwright `connectOverCDP` over Cloud CDP URL** — auth /
    WebSocket-shape nuances. Smoke catches it; mocks cannot.
  - **R3 — Video frame capture (Task 3)** — path (a) is genuinely
    complex; bail to path (b) (poster-only + warning) is bounded.
