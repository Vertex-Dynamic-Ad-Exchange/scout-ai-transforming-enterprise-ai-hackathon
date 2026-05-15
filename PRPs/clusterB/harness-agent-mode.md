name: "Harness — PRP-C1: Agent-mode SDK driver + consent-wall heuristic (TDD)"
description: |

  Fourth of five PRPs for `features/clusterB/harness-capture-page.md`. Lands
  `agentMode.ts` (SDK driver) + `consentWall.ts` (heuristic) + replaces the
  PRP-B2 D4/D5 stubs in `browserMode.ts`. After this PRP,
  `opts.forceAgentMode: true` works end-to-end; consent-wall pages from
  Browser mode surface `CONSENT_WALL_UNRESOLVED` but do NOT yet auto-retry —
  the two-pass orchestrator lands in PRP-C2.

  **Prereqs**: PRP-A, PRP-B1, PRP-B2 merged.

  ## TDD discipline

  **Red → Green → Refactor.** Test first; run; confirm correct-reason red;
  minimum impl; tidy. Commit at green. The `vi.mock("browser-use-sdk")`
  scaffolding from PRP-B2 is *extended* here — add `sessions.create` and
  `tasks.create` stubs alongside the existing `browsers.create`.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A; warm path. Hot-path boundary pinned by PRP-
    B2 Task 13.
  - **Plug-and-play** — Same `Harness` surface; Agent mode is internal.
  - **Sponsor tech** — **This is the agreed-exception surface.**
    `client.tasks.create` triggers the vendor's internal LLM on browser-
    use Cloud. That LLM is not ours; we can't route it through Lobster
    Trap. Bounded by (a) fixed-string prompt with only `url` interpolated,
    (b) "do not follow off-origin links" written into the prompt itself.
    Per `features/clusterB/harness-capture-page.md:109`. PRP-C2 documents
    in README + CLAUDE.md.

  ## CLAUDE.md rules that bite

  - 300-line file cap. `agentMode.ts` is biggest; extract
    `agentAssemble.ts` if needed.
  - Deps already approved (PRP-B1 Task 1).

  ## Decisions (locked here)

  | # | Question | Locked answer |
  |---|---|---|
  | D1 | Agent entrypoint | `sessions.create({ startUrl, persistMemory: false, keepAlive: false, ... })` → `tasks.create({ sessionId, task, schema })`. Two calls = clean tear-down handle. |
  | D2 | Agent prompt | Fixed string; only `url` interpolated. T3c asserts no other template variables. |
  | D3 | Structured output | zod `AgentOutputSchema` passed to `tasks.create({ schema })`. Output normalized to `PageCapture` via `assembleAgentCapture`. |
  | D4 | Consent-wall heuristic | Static selector list + content-starvation floor (`innerText.length < 200`). False positives = extra Agent round-trip; false negatives = low-quality Browser capture. v1 trade. |
  | D5 | Agent hard cap | `opts.timeoutMs ?? 60_000`. `Promise.race` against `setTimeout` mirroring PRP-B2 Task 12 path B. |
  | D6 | `forceAgentMode: true` | Wired interim in `factory.ts` (one-line conditional). PRP-C2 centralizes in `capture.ts`. |

  ## SDK shape (Agent mode, verified upstream 2026-05-15)

  ```ts
  const session = await client.sessions.create({
    proxyCountryCode: "us",        // alpha-2 LOWERCASE; SDK auto-lowercases
    startUrl: url,
    browserScreenWidth: 1280, browserScreenHeight: 800,
    persistMemory: false,          // tenancy pin
    keepAlive: false,              // tenancy + cost pin
  });
  const taskRun = await client.tasks.create({
    sessionId: session.id, task: AGENT_TASK_PROMPT(url), schema: AgentOutputSchema,
  });
  const output = await taskRun.complete();   // verify exact method in src/v2/helpers.ts on impl
  // try { ... } finally { await client.sessions.stop(session.id); }
  ```

  ## All Needed Context

  ```yaml
  - file: PRPs/clusterB/harness-contracts.md
    why: Prereq A — @scout/shared types.
  - file: PRPs/clusterB/harness-browser-helpers.md
    why: Prereq B1 — config, errors, hash, storage helpers reused.
  - file: PRPs/clusterB/harness-browser-mode.md
    why: Prereq B2 — D4/D5 stubs this PRP replaces; SDK mock module
      extended here.
  - file: features/clusterB/harness-capture-page.md
    section: "Agent-mode escape hatch (line 49); Security (lines 151-
      158); Sponsor-tech relevance (line 109)"
    why: Source spec for behavior + agreed exception.
  - url: https://github.com/browser-use/sdk/blob/main/browser-use-node/src/v2/resources/sessions.ts
    why: Sessions.create() signature; persistMemory/keepAlive tenancy
      knobs.
  - url: https://github.com/browser-use/sdk/blob/main/browser-use-node/src/v2/resources/tasks.ts
    why: Tasks.create() + TaskRun shape.
  - url: https://github.com/browser-use/sdk/blob/main/browser-use-node/src/v2/helpers.ts
    why: Verify exact TaskRun.complete() / .output method during impl.
  ```

  ## Files

  ```
  packages/harness/src/
    consentWall.ts             (NEW) + __tests__/consentWall.test.ts
    agentMode.ts               (NEW) + __tests__/agentMode.test.ts
    browserMode.ts             (MOD) — replace D4 stub; remove D5 throw
    factory.ts                 (MOD) — interim forceAgentMode branch
    __tests__/browserMode.test.ts (MOD) — update T2a expected code
  ```

  ## Task order (TDD)

  ### Task 1 — Red→Green: `consentWall.ts`

  Red. `consentWall.test.ts` with fake `Page` (typed against
  `playwright.Page`; implements `.$$()` and `.evaluate()` only):

  - **T1a — banner ID hit** — `page.$$("#onetrust-banner-sdk")` returns
    one element → `true`.
  - **T1b — generic selector hit** — `[class*="consent"]` returns one
    element → `true`.
  - **T1c — content starvation** — all banner selectors empty; body
    `innerText.length === 5` → `true`.
  - **T1d — normal page** — banner selectors empty; `innerText.length
    === 5000` → `false`.

  Green:

  ```ts
  import type { Page } from "playwright";

  const BANNER_SELECTORS: ReadonlyArray<string> = [
    "#onetrust-banner-sdk",
    "[id*=\"cookie-banner\"]",
    "[class*=\"consent\"]",
    "[class*=\"cookie-notice\"]",
    "[data-testid*=\"cookie\"]",
  ];
  const MIN_BODY_TEXT_CHARS = 200;

  export async function detectConsentWall(page: Page): Promise<boolean> {
    for (const sel of BANNER_SELECTORS) {
      if ((await page.$$(sel)).length > 0) return true;
    }
    const len = await page.evaluate(() => (document.body?.innerText ?? "").length);
    return len < MIN_BODY_TEXT_CHARS;
  }
  ```

  ### Task 2 — Red→Green: replace D4 stub in `browserMode.ts`

  Red. Update PRP-B2's `T2a` (consent-wall) test:

  ```ts
  expect(err.code).toBe(HarnessError.CONSENT_WALL_UNRESOLVED);
  expect(err.message).toMatch(/consent wall/);
  ```

  Run → red (still throws `NAVIGATION_FAILED`).

  Green. In `browserMode.ts`:

  ```diff
  - if (await detectConsentWall(page)) throw new HarnessException(HarnessError.NAVIGATION_FAILED, "consent wall (PRP-C handles)");
  + if (await detectConsentWall(page)) throw new HarnessException(HarnessError.CONSENT_WALL_UNRESOLVED, "consent wall present");
  ```

  Also remove the PRP-B2 D5 `forceAgentMode` throw — Task 4 below
  rewires `factory.ts` to handle that branch upstream.

  ### Task 3 — Red→Green: `agentMode.ts`

  Red. `agentMode.test.ts`:

  - **T3a — happy** — `sessions.create` mock resolves `{ id: "agent-1",
    ... }`; `tasks.create` mock returns a `TaskRun` whose `.complete()`
    resolves with valid `AgentOutput`. Drive `captureViaAgent(sdk, cfg,
    "https://example.test/article", {})`. Assert:
    - `result.capturedBy.mode === "agent"`, `.sessionId === "agent-1"`
    - `result.screenshots.length >= 1`
    - `result.url === <finalUrl from mock>`
    - `sessions.create` spy: **both** `persistMemory: false` AND
      `keepAlive: false` (tenancy pins).
    - `tasks.create` spy: `task === AGENT_TASK_PROMPT(url)` (exact match).
    - `sessions.stop("agent-1")` called exactly once.
  - **T3b — failure mapping** — `tasks.create` mock rejects with
    422-shaped error → throws `HarnessException` with `code ===
    UPSTREAM_DOWN`.
  - **T3c — prompt-injection mitigation** — module-level (no SDK call):
    - `AGENT_TASK_PROMPT("https://x.test/").match(/\{[a-zA-Z_]+\}/)`
      is `null` (no template variables).
    - 10 random URL substitutions; prompt differs only at the URL
      position.
  - **T3d — timeout cap** — `opts.timeoutMs: 100` + `tasks.create`
    mock that never resolves → throws `HarnessError.TIMEOUT` within
    ~150ms slack. Use `vi.useFakeTimers` + `advanceTimersByTime`.
  - **T3e — `geo` passthrough** — `opts.geo: "DE"` → `sessions.create`
    spy receives `proxyCountryCode: "de"`; output `geo === "DE"`.
  - **T3f — schema-conformance regression** — `tasks.create` mock
    resolves with object missing `finalUrl` → throws `UPSTREAM_DOWN`;
    message regex `/^agent output invalid at path: [\w.]+$/`.

  Green. `agentMode.ts` outline (≤ 200 lines; extract
  `agentAssemble.ts` if it grows):

  - `const AGENT_TASK_PROMPT = (url: string) => "Navigate to ${url}. \
    Dismiss any cookie or consent banners using the most permissive \
    option that does NOT require account creation. Do not click any \
    login or signup buttons. Do not follow off-origin links. Scroll \
    the page once to load lazy content. Then stop and return control. \
    Report what you saw using the structured output schema."` (single
    expression; T3c regex asserts no `\{name\}` template variables).
  - `const AgentOutputSchema = z.object({ finalUrl: z.string().url(),
    pageTitle/pageHeadline/visibleText/metaDescription/metaOgType/metaLang
    (nullable strings), screenshotBase64: z.array(z.string().min(1)).min(1),
    videoPresent: z.boolean(), videoPosterBase64: z.string().nullable() })`.
  - `captureViaAgent(sdk, cfg, url, opts)`:
    - `timeoutMs = opts.timeoutMs ?? 60_000`, viewport, geo defaults.
    - `session = await sdk.sessions.create({ proxyCountryCode: geo,
      startUrl: url, browserScreenWidth, browserScreenHeight,
      persistMemory: false, keepAlive: false })`.
    - `try` block: `taskRun = await sdk.tasks.create({ sessionId,
      task: AGENT_TASK_PROMPT(url), schema: AgentOutputSchema })`.
      `Promise.race([taskRun.complete(), timeoutReject])` where
      `timeoutReject = new Promise<never>((_, rj) => setTimeout(() =>
      rj(new HarnessException(TIMEOUT, "agent task timeout")), timeoutMs))`.
    - `safeParse` the output; on fail throw `UPSTREAM_DOWN` with path-
      only message.
    - Delegate to `assembleAgentCapture` (sibling helper).
    - `catch`: wrap non-HarnessException via `classifySdkError`.
    - `finally`: `try { await sdk.sessions.stop(session.id); } catch {}`.
  - `assembleAgentCapture(cfg, url, geo, sessionId, out)`:
    - Decode each `screenshotBase64[i]` via `Buffer.from(b64, "base64")`;
      `writeScreenshot(baseDir, STORAGE_PLACEHOLDER, i, bytes, { kind: i
      === 0 ? "above_fold" : "viewport_sample", scrollY: i * 800,
      viewport })`.
    - If `videoPresent && videoPosterBase64`:
      `writeVideoSample(..., { kind: "poster", timestampMs: 0 })` +
      push warning `"video_first_second_frame_unavailable_in_agent_mode"`.
    - `visibleText = out.visibleText.normalize("NFC")`; truncate via
      `truncateToBytes(visibleText, MAX_DOM_TEXT_BYTES)` (from
      `extract.ts`) if over cap; push `"dom_text_truncated"` warning if
      cut.
    - `contentHash = computeContentHash(visibleText, screenshots.map(s
      => s.bytes))`.
    - Rename placeholder dir → `{contentHash}`; rewrite URIs via
      `rehomeUri`.
    - Assemble `PageCapture` (mode `"agent"`, sdkVersion pin,
      sessionId), run `PageCaptureSchema.safeParse(result)`, on fail
      throw `UPSTREAM_DOWN` with path-only message.

  Refactor: extract `assembleAgentCapture` to `agentAssemble.ts` once
  green if `agentMode.ts` is approaching 200 lines.

  ### Task 4 — Red→Green: `factory.ts` `forceAgentMode` branch

  Red. Add to `factory.test.ts`:

  - **T4a** — `createHarness().capturePage(url, { forceAgentMode: true
    })` calls only `captureViaAgent` (spy); never `captureViaBrowser`.

  Green. Interim wire in `factory.ts`:

  ```ts
  return {
    capturePage: async (url, opts = {}) => {
      if (opts.forceAgentMode) return captureViaAgent(sdk, cfg, url, opts);
      return captureViaBrowser(sdk, cfg, url, opts);
    },
  } satisfies Harness;
  ```

  One-line conditional. PRP-C2 replaces this with a single delegate to
  `capture.ts`.

  ### Task 5 — Full validation sweep

  ```bash
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r exec prettier --write .
  pnpm -r test
  pnpm -r build
  # Manual:
  pnpm --filter @scout/harness run smoke
  ```

  Extend the smoke script with `--force-agent` flag for the static
  article URL — exercises Agent mode live before PRP-C2 lands.

  ## Security guardrails

  - **Tenancy pins** — T3a's `sessions.create` spy asserts
    `persistMemory: false` AND `keepAlive: false`. A regression on
    either is a cross-advertiser leak.
  - **Prompt-injection mitigation** — T3c regex pins no template
    variables other than `url`. The `do not follow off-origin links`
    clause is the second layer; we cannot enforce inside the vendor
    loop.
  - **Orphan session cleanup** — `try { ... } finally { await
    sdk.sessions.stop(session.id); }` (T3a spy assertion). Same money-
    leak risk as Browser mode.
  - **Exit-time `safeParse`** — `assembleAgentCapture` runs
    `PageCaptureSchema.safeParse(result)` before return; on failure
    throws `UPSTREAM_DOWN` with **path-only** message (`visibleText`
    may carry PII).
  - **No off-origin link follow** — written into the prompt; bounded by
    `keepAlive: false`.
  - **`BROWSER_USE_API_KEY`** — already restricted to `config.ts` by
    PRP-B1; Agent mode adds no new env read.

  ## Out of scope (PRP-C2)

  - `capture.ts` two-pass orchestrator (Browser → Agent on
    `BLOCKED` / `CONSENT_WALL_UNRESOLVED`).
  - `packages/harness/README.md` — agent-mode sponsor-tech exception.
  - `CLAUDE.md § Stack` lock-in.
  - SDK AbortSignal refinement on Agent-mode (T3d uses
    `Promise.race`; if SDK accepts a signal on `tasks.create` per
    `helpers.ts`, simplify and record finding).

  ## Anti-Patterns

  - ❌ Interpolate any value other than `url` into `AGENT_TASK_PROMPT`.
    T3c is the gate.
  - ❌ `keepAlive: true` or `persistMemory: true` "to save cost". Leak.
  - ❌ Skip `sessions.stop()` in `finally`. Orphaned sessions accrue
    cost.
  - ❌ Try to route the vendor LLM through Lobster Trap. It's not ours.
  - ❌ `visibleText.slice(0, 256 * 1024)` — char count, not bytes. Use
    `truncateToBytes` from `extract.ts`.
  - ❌ Permanent `--force-agent` CLI in production. Smoke-script only;
    profiler invokes via `opts.forceAgentMode`.

  ## Confidence: 7 / 10

  Strengths: SDK source read-verified; agent prompt bounded and
  testable; tenancy pins spy-asserted.

  Risks:
  - **R1 — `TaskRun.complete()` exact method name.** Read
    `src/v2/helpers.ts` during impl; adjust both `agentMode.ts` AND
    T3a mock surface if it differs.
  - **R2 — Vendor LLM schema-violating output.** Occasional; `safeParse`
    re-wraps as `UPSTREAM_DOWN`. Smoke surfaces it.
  - **R3 — Consent-wall heuristic false positives.** Acceptable cost
    is latency; expand selector list if smoke surfaces missed banners.
