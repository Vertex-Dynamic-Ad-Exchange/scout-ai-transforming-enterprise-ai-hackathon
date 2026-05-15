You are a senior Node/TypeScript backend engineer fluent in headless-browser automation under hostile real-world page conditions (consent walls, geo-paywalls, JS-rendered SPAs, lazy-loaded media), `browser-use-sdk/v2` Browser-mode session lifecycle (`client.v2.browsers.create` → page control → tear-down) with the Agent-mode escape hatch only as a last resort, deterministic content hashing for cache-key stability, screenshot/DOM extraction at fixed viewport sizes, and the plug-and-play discipline of hiding a third-party SDK behind a single-function seam so the warm path can swap providers without touching consumers.

## PRIORITY:

**P1 — warm-path-blocking, demo-load-bearing.** Corresponds to the `harness-capture-page.md` row in `FEATURE-TODO.md` under *Cluster B — Warm path*. Independent of every verifier prompt (`FEATURE-TODO.md:50-52`) — output is a typed `PageCapture`, so the four agents can be built against a fixture in parallel. Until this lands, `profiler-real-loop.md` has nothing to feed verifiers (foundation only stubs `harness.capturePage` returning a fixed shape — see `packages/harness/src/index.ts:1`), so every demo `PageProfile` is synthetic, the *declared-vs-detected intent diff* moment in `dashboard-verdict-views.md` shows hand-crafted data, and the cache the gate reads (`features/architecture.md:32-37`) only contains hand-seeded entries. **Latency stakes — explicitly NOT hot path.** This is warm path: seconds-to-minutes per page is acceptable (`features/architecture.md:55`); the capture call **must not** be invoked from `packages/gate/**`, and the foundation ESLint boundary at `PRPs/foundation-ad-verification.md:157-159` already blocks that import — preserve it.

## FEATURE:

Replace the foundation stub at `packages/harness/src/index.ts:1` (currently `export {};`) with the real `capturePage(url, opts) → PageCapture` body described in `features/architecture.md:113-115` and `features/architecture.md:47`, **plus** lock the cross-package contracts foundation hand-waved (per `PRPs/foundation-ad-verification.md:136`) but never landed in `@scout/shared`. Same pattern as `features/clusterA/policy-match-evaluation.md` locking `PolicyMatchResult`: the consumer-side type goes in `@scout/shared`; the provider package implements against it.

End state:

- **New shared schema**: `packages/shared/src/schemas/capture.ts` exports `PageCaptureSchema` + `ScreenshotSchema` + `VideoSampleSchema` + `CaptureOptionsSchema`, added to the barrel at `packages/shared/src/index.ts`. Shape:
  ```ts
  PageCapture = {
    url: string,                       // post-redirect final URL (NOT the input url)
    requestedUrl: string,              // verbatim input — for cache key + audit replay
    contentHash: string,               // sha256 hex over stable-canonicalized DOM text + screenshot bytes (see Gotchas)
    capturedAt: string,                // ISO8601 (datetime); the freshness signal for PageProfile.ttl
    geo: string,                       // alpha-2; the proxy/region the page was rendered from
    domText: string,                   // visible-text projection of the rendered DOM, ≤ MAX_DOM_TEXT_BYTES (256 KiB)
    headline: string | null,           // <h1> or <title> fallback — separated so verifiers can weight it
    metadata: { title: string | null, description: string | null, ogType: string | null, lang: string | null },
    screenshots: Screenshot[],         // ordered: [aboveFold, ...viewportSamples]
    videoSamples: VideoSample[],       // empty when no <video>/<iframe video> present; never null
    capturedBy: { mode: "browser" | "agent", sdkVersion: string, sessionId: string },
    warnings: string[],                // non-fatal capture issues (e.g., "consent_wall_skipped", "video_skipped_too_long")
  }

  Screenshot = { uri: string, kind: "above_fold" | "viewport_sample", scrollY: number, viewport: { w: number, h: number }, bytes: number }
  VideoSample = { uri: string, kind: "poster" | "first_second_frame", timestampMs: number, bytes: number }

  CaptureOptions = {
    geo?: string,                      // alpha-2; defaults to "US" — proxy region for stealth browser
    timeoutMs?: number,                // total cap; defaults to CAPTURE_TIMEOUT_DEFAULT_MS (15000)
    viewport?: { w: number, h: number },     // defaults to 1280×800
    sampleScrolls?: number,            // additional viewport-height scrolls beyond above-fold; default 2
    captureVideo?: boolean,            // default true; profiler's Q6 cost trip-wire flips this off
    forceAgentMode?: boolean,          // default false; explicit escape hatch for tests/known-hostile sites
  }
  ```
- **New shared interface**: `packages/shared/src/interfaces/harness.ts` exports `Harness { capturePage(url: string, opts?: CaptureOptions): Promise<PageCapture> }` plus a sibling `HarnessError` enum (`TIMEOUT | NAVIGATION_FAILED | BLOCKED | CONSENT_WALL_UNRESOLVED | UPSTREAM_DOWN`). Foundation never landed `shared/src/interfaces/` (verify: directory does not exist as of 2026-05-14); this PRP creates it. Add a barrel re-export from `packages/shared/src/index.ts`.
- **Real `capturePage()`**: `packages/harness/src/capture.ts` exports the function; `packages/harness/src/index.ts` becomes the barrel exporting `createHarness()` (returns a `Harness`-typed object — same factory shape as `@scout/llm-client.createLlmClient` from `PRPs/foundation-ad-verification.md:175`). Body ≤ 200 lines — extract `browserMode.ts` (cloud Browser-mode driver), `agentMode.ts` (Agent-mode fallback driver), `extract.ts` (DOM-text canonicalization + visible-text projection + headline/metadata pull), `hash.ts` (`contentHash` computation), and `screenshots.ts` (above-fold + scroll-sample loop + video poster/frame extraction) as siblings. Each ≤ 150 lines.
- **Browser-mode default** (Q5 lock, `PRPs/foundation-ad-verification.md:28`): use `browser-use-sdk/v2` `client.v2.browsers.create()` for deterministic page control. Cloud API per Q4 lock — `BROWSER_USE_API_KEY` read **only** in `packages/harness/src/config.ts`, never elsewhere (mirror `@scout/llm-client/src/config.ts` from `PRPs/foundation-ad-verification.md:209-213`).
- **Agent-mode escape hatch**: triggered when Browser mode raises `CONSENT_WALL_UNRESOLVED` or `BLOCKED`, OR when `opts.forceAgentMode` is true. Wraps `client.v2.sessions.create()` + `run()` with a fixed task prompt: "navigate to {url}, dismiss any cookie/consent banners using the most permissive option that does not require account creation, scroll the page once, then return control." Output is normalized to the same `PageCapture` shape. **The Agent-mode loop calls an LLM internally on the browser-use Cloud side**; this is *not* a Lobster-Trap-routed call — call it out in `OTHER CONSIDERATIONS` as the agreed sponsor-tech exception (the LLM is the harness vendor's, not ours).
- **License resolution** (the "open license question" named in the FEATURE-TODO row): inspect the source repo at <https://github.com/browser-use/browser-use> for `LICENSE`. If MIT/Apache-2/BSD: document the self-host fallback path in `packages/harness/README.md` with a one-paragraph install note and call it the productionization story. If SaaS-only or a non-permissive license: lock Cloud-only as the demo and post-hackathon path, file the self-host story as a follow-up, and update `CLAUDE.md § Stack` with the lock so the next reader doesn't re-investigate. **Either outcome is acceptable; silently shipping without a determination is not.**
- **Latency budget** — warm path, **NOT hot path** (architecture.md:55). Soft target: P95 ≤ 8 s for a typical content page in Browser mode; P95 ≤ 30 s when Agent-mode fallback fires. Hard cap: `opts.timeoutMs ?? 15000` for Browser mode, `opts.timeoutMs ?? 60000` for Agent mode. Tests assert *the cap is honored*, not a specific target — real-world latency varies wildly with page weight and proxy region.
- **`contentHash` stability** (load-bearing for the cache the gate reads; `features/architecture.md:32`): `sha256(canonicalDomText || "\x00" || sortedScreenshotByteLengths.join("|"))`. Canonical DOM text strips: scripts, styles, comments, attribute-only nodes, runs of `\s+` collapsed, NFC-normalized. Two consecutive captures of the same static page must produce equal hashes (test); a captured cookie-banner state difference must not (test).
- **Cache miss handling**: `capturePage` itself does NOT cache. Caching is the profiler's job (`features/architecture.md:53`); the harness is stateless. A second call on the same URL re-executes — verified by a test asserting two browser sessions get created.
- **Tests — exhaustive matrix**, not 1/1/1, because this is the source of truth for every downstream `PageProfile`. Cluster A's matrix density (`features/clusterA/gate-verdict-logic.md:36-47`) is the bar:
  - **Schema conformance**: every code path produces a value that `PageCaptureSchema.parse()` accepts. Pinned with a defense-in-depth `parse()` call at the function exit before return.
  - **Browser-mode happy**: a static fixture page rendered against a recorded `browser-use-sdk` mock returns `mode: "browser"`, ≥1 screenshot, `domText` non-empty, `videoSamples: []`, `warnings: []`.
  - **Browser-mode happy with video**: page with `<video>` returns ≥1 `VideoSample` with `kind: "poster"`; `kind: "first_second_frame"` present when video duration ≥1s.
  - **`captureVideo: false`**: profiler-cost-trip-wire path — video skipped, `videoSamples: []`, `warnings: ["video_skipped_by_option"]` (asserts the trip-wire from `FEATURE-TODO.md:55` is wired and observable).
  - **Above-fold + scroll samples**: with `sampleScrolls: 2`, exactly 3 screenshots returned, `scrollY` strictly increasing.
  - **Determinism (`contentHash`)**: same fixture page captured twice → identical `contentHash`. Pinned hash value in fixture — a regression here invalidates every cached `PageProfile` in production.
  - **Determinism (insensitivity to volatile noise)**: a fixture with a clock-driven element (`<div id=now>2026-05-14T10:00:00Z</div>`) and a same-page capture stubbing the clock to the next second → identical `contentHash` (volatile-element strip-list works) OR documented divergence with the strip rule that would be needed (file as follow-up).
  - **Edge — `domText` truncation**: a page with >256 KiB visible text returns `domText.length === 256 * 1024` and `warnings: ["dom_text_truncated"]`.
  - **Edge — post-redirect URL**: requested URL `http://example.test/a` redirects to `https://example.test/b` → `requestedUrl === ".../a"`, `url === ".../b"`. Cache-key callers use `requestedUrl`; verifiers see `url`.
  - **Edge — geo-proxy passthrough**: `opts.geo: "DE"` results in `client.v2.browsers.create({ proxy: { country: "DE" } })` (asserted via mock spy); output `capture.geo === "DE"`.
  - **Failure — Browser-mode timeout**: `opts.timeoutMs: 100` against a never-resolving navigate → throws `HarnessError.TIMEOUT`. `vi.useFakeTimers` + an `AbortController` plumbed into the SDK call. **No leaked promise after rejection** — assert via a `process.on("unhandledRejection")` spy.
  - **Failure — consent wall triggers Agent-mode fallback**: Browser-mode mock throws a `BLOCKED`-equivalent → `capturePage` retries via Agent mode; result has `mode: "agent"`, `warnings: ["consent_wall_handled_via_agent_mode"]`. Asserts the escape-hatch path actually fires.
  - **Failure — Agent-mode also fails**: both modes exhausted → throws `HarnessError.CONSENT_WALL_UNRESOLVED`. Profiler is responsible for handling the throw; harness does not silently emit a partial capture.
  - **Failure — `BROWSER_USE_API_KEY` missing**: throws at `createHarness()` time with a message that does NOT include the env-var value (defense against accidental log leakage of the key fragment, even though it's missing here).
  - **Failure — schema conformance regression**: a deliberately malformed mock response (e.g., screenshot byte count negative) → `PageCaptureSchema.parse` throws with a zod issue path; harness re-wraps as `HarnessError.UPSTREAM_DOWN` rather than leaking zod internals.
- **Live integration smoke** (`packages/harness/scripts/smoke-capture.ts`): drives a real `BROWSER_USE_API_KEY` against three fixed URLs (a static news page, an SPA, a video-heavy page) and prints a one-line `mode/timeMs/screenshotCount/videoCount/contentHash` line per capture. Excluded from `pnpm test` (no API key in CI); runnable as `pnpm --filter @scout/harness run smoke`. Required to run **at least once before stage** so the demo bidstream's URLs aren't first-touched on demo day.

## EXAMPLES:

- `packages/harness/src/index.ts:1` — current `export {};` stub from foundation task 5 (`PRPs/foundation-ad-verification.md:246-249`). This PRP replaces it with a barrel exporting `createHarness` + `capturePage`.
- `packages/harness/package.json:11-13` — current `dependencies` contains only `@scout/shared`. This PRP adds `browser-use-sdk` (pin a specific patch version — `*-latest` aliases drift, same anti-pattern as `PRPs/foundation-ad-verification.md:215-217` for Gemini model IDs).
- `packages/shared/src/index.ts:1-5` — current barrel exports schemas only; no `interfaces/` yet. Add `export * from "./schemas/capture.js"` and `export * from "./interfaces/harness.js"` (creates the `interfaces/` directory — first occupant).
- `packages/shared/src/schemas/profile.ts:22-31` — `PageProfileSchema`. The profiler maps `PageCapture → PageProfile` (categories + entities are produced by verifiers, not harness), so `PageCapture.contentHash` flows into `PageProfile.contentHash` byte-for-byte; `PageCapture.url` flows into `PageProfile.url`. Drift between the two field names = silent cache poisoning.
- `packages/shared/src/schemas/profile.ts:16-20` — `EvidenceRefSchema { kind: "screenshot" | "dom_snippet" | "video_frame", uri }`. The profiler builds `evidenceRefs[]` from `PageCapture.screenshots[]` and `videoSamples[]`; the URIs this PRP emits MUST be reachable by whatever serves the dashboard's evidence drill-down (see *Open questions — evidence storage*).
- `packages/shared/src/schemas/bid.ts:8` — `BidVerificationRequest.geo` is alpha-2. Profiler will pass this through into `CaptureOptions.geo` so the page is rendered from the same region the bid claims to serve. **Same regex (`/^[A-Z]{2}$/`)** — reuse the validation, do not re-declare.
- `packages/llm-client/src/index.ts:1` — pattern reference for the package shape: `createX()` factory returning an interface-typed object, `config.ts` reading exactly one env var, real implementation behind a stub-replaceable seam. Mirror this shape in `@scout/harness`. (As of 2026-05-14 the file is the foundation stub; the real `createLlmClient` body lands in foundation task 5 per `PRPs/foundation-ad-verification.md:246-249`.)
- `features/architecture.md:47` — the architecture doc's one-line capture spec: *"Browser harness: `browser-use` headless session renders the page, captures DOM text, screenshots (above-fold + viewport scroll samples), and any embedded video poster frames / first-second sample. Output is a structured `PageCapture` blob, not raw HTML."* Each field on the schema above maps 1:1 to one phrase here.
- `features/architecture.md:84-93` — `browser-use` confirmed traits (Browser mode vs. Agent mode, stealth + 195+ countries, license unconfirmed). The "open license question" line in the FEATURE-TODO row is this paragraph's last sentence; this PRP closes it.
- `features/architecture.md:113-115` — module boundary: `harness/` is one function, `capturePage(url, opts) → PageCapture`, hiding the mode choice. The Agent/Browser switch lives **inside** the package; consumers see one signature.
- `features/architecture.md:153-159` — *What we are explicitly NOT building*: real RTB integration (so cache-misses are demo-driven), live publisher onboarding (so URLs are pre-seeded), multi-region cache. Each constrains what `capturePage` is *allowed* to assume — e.g., we can't assume any URL has been pre-warmed.
- `features/clusterA/gate-verdict-logic.md:24-28` + `features/clusterA/policy-match-evaluation.md:8-11` — the two consumers downstream of `PageCapture → PageProfile`. Their behavior is the reason `contentHash` stability matters; cite them when the implementer is tempted to "just hash the raw HTML."
- `features/clusterA/policy-match-evaluation.md:124` — note that `creative_tag` rule kind is currently a no-op because `PageProfile` lacks `creativeTags`. **`creativeTags` is not harness's job** — they describe the advertiser's creative, not the destination page (the creative arrives via `BidVerificationRequest.creativeRef`, not page rendering). Call this out in *Out of scope* so the next implementer doesn't pull it in here.
- `PRPs/foundation-ad-verification.md:28` — Q5 lock: Browser mode default via `browser-use-sdk/v2` `client.v2.browsers.*`. Method names are NOT documented in the npm README; foundation defers verification to this PRP — inspect `node_modules/browser-use-sdk/dist/v2/resources/browsers.d.ts` after `pnpm add` and pin the actual API surface in `browserMode.ts`.
- `PRPs/foundation-ad-verification.md:84-86` — env var is `BROWSER_USE_API_KEY`. Foundation does NOT call the SDK. This PRP is the first call site.
- `PRPs/foundation-ad-verification.md:209-213` — pattern for env-var isolation (`config.ts`, single import site, no `process.env.*` outside it). Mirror in `packages/harness/src/config.ts`.
- `PRPs/foundation-ad-verification.md:115-203` — pattern for the `createX()` factory + interface seam. The LlmClient pseudocode is the closest in-repo precedent for what `createHarness()` should look like.
- **Greenfield otherwise** — no in-repo browser-automation precedent. External references in *DOCUMENTATION*.

## DOCUMENTATION:

- browser-use cloud product + Browser-vs-Agent mode overview: <https://docs.browser-use.com/>
- browser-use Node SDK source — Browser-mode resources (the foundation Q5 escape route, since the npm README only documents Agent mode): <https://github.com/browser-use/sdk/tree/main/src/v2/resources>
- browser-use core engine repo (license check target — the "open license question" is resolved by reading the `LICENSE` file here): <https://github.com/browser-use/browser-use/blob/main/LICENSE>
- browser-use Cloud API reference — `sessions.create`, `run`, browsers and proxies: <https://docs.browser-use.com/api-reference>
- Stealth browsers + residential proxies (geo-proxy passthrough; the reason `CaptureOptions.geo` exists): <https://docs.browser-use.com/features/stealth>
- W3C "Determining Visible Text" — informs the visible-text projection rule used by `extract.ts` (script/style strip, `display:none` filter, computed-style aware): <https://www.w3.org/TR/wai-aria-1.2/#aria-hidden> (deep-link to the visibility section, not the landing page)
- Unicode NFC normalization (used by the `contentHash` canonicalization step — without it, "café" hashed as `café` vs. `café` produces two different PageProfiles for the same content): <https://www.unicode.org/reports/tr15/#Norm_Forms>
- Node `crypto.createHash("sha256")` (the digest impl; native, no extra dep): <https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options>
- vitest `test.each` for the screenshot-count and video-sample matrices: <https://vitest.dev/api/#test-each>
- **Pin Gemini model IDs** — N/A for this feature; harness makes no LLM call directly. The Agent-mode escape hatch is the *only* path that touches an LLM, and it's the browser-use vendor's internal model — see *Other Considerations* for the sponsor-tech-bypass justification.
- **Lobster Trap policy syntax** — N/A for this feature; no agent→LLM call routes through this package. The seam is preserved by *not introducing one* here.

## OTHER CONSIDERATIONS:

- **Sponsor-tech relevance: NEITHER, with one explicit exception to surface.** No Gemini call (verifiers do that); no Lobster Trap call (no LLM seam in this package). The exception: if the Agent-mode escape hatch fires, browser-use Cloud invokes its own LLM internally to drive the session — this is the vendor's LLM, not ours, and we cannot route it through Lobster Trap. **This is the agreed exception**; record it in `packages/harness/README.md` and in this PRP, do not silently ignore the architecture rule. Mitigation: the Agent-mode prompt is a fixed task string we control (no advertiser content interpolated into the prompt — that lives strictly in the verifier-agent prompts under `packages/agents/**`, where Lobster Trap *does* apply).

- **Open question — license on the self-hosted browser-use harness.**
  - **(A) Permissive (MIT/Apache-2/BSD).** Document the self-host fallback path in `packages/harness/README.md`; lock Cloud-API for the hackathon demo (Q4 already does this); productionization story is "lift and shift to self-host."
  - **(B) Non-permissive (SaaS-only or copyleft incompatible with our MIT submission requirement).** Lock Cloud-only as the only supported path; file the self-host story as a follow-up; update `CLAUDE.md § Stack` to record the lock.
  - **Recommend: resolve before writing code, then proceed.** This is not a real choice — read the LICENSE file at <https://github.com/browser-use/browser-use/blob/main/LICENSE> and act on what it says. The work is closing the unknown, not picking a side.

- **Open question — `PageCapture` and `Harness` location.**
  - **(A) `@scout/shared` (`packages/shared/src/schemas/capture.ts` + `packages/shared/src/interfaces/harness.ts`).** Cross-package contract (harness emits, profiler consumes); CLAUDE.md § Stack pins cross-cutting shapes to `@scout/shared`; foundation's intent per `PRPs/foundation-ad-verification.md:136`.
  - **(B) Inside `@scout/harness`, re-exported by profiler.** Cheaper now; breaks the rule the same way (B) broke it for `PolicyMatchResult` in `features/clusterA/policy-match-evaluation.md:88`.
  - **Recommend (A).** Match the precedent set in Cluster A; one new schema file + one new interface file + two barrel lines.

- **Open question — Agent-mode fallback heuristic.**
  - **(A) Two-pass: Browser mode first, Agent mode on `BLOCKED` / `CONSENT_WALL_UNRESOLVED`.** Captures the simple cases cheaply, escalates only for hostile pages. ~3× latency on the escalation path.
  - **(B) Agent mode end-to-end.** Simpler code, ~5–10× latency on every page, ~5–10× cost. Architecture doc (`features/architecture.md:90`) explicitly recommends against this.
  - **(C) Browser mode only; throw on hostile pages.** Profiler retries on a different proxy region. No Agent-mode dependency at all — but loses the demo's "agent loops live in the warm path" story.
  - **Recommend (A).** Matches the architecture's stated preference; preserves the demo narrative ("we use agent loops where they belong"); cost-bounded by the same `opts.timeoutMs` cap.

- **Open question — screenshot strategy.**
  - **(A) Above-fold + N viewport-height scrolls** (default `sampleScrolls: 2` → 3 screenshots total). Bounded screenshot count; covers most page content; verifier batch size predictable.
  - **(B) Full-page single screenshot.** One image but extremely tall ones break the image-verifier's vision context window and trigger Gemini's "image too large" error.
  - **(C) DOM-element-scoped screenshots.** Best-quality evidence per signal but requires the verifier to drive the harness — couples two seams the architecture keeps separate (`features/architecture.md:113-115`).
  - **Recommend (A).** Verifier prompts (Cluster C) can rely on a stable upper bound on image count.

- **Open question — video sampling depth.**
  - **(A) Poster + first-second frame only.** Two `VideoSample`s per video; bounded cost; matches the architecture's *"poster frames / first-second sample"* phrase verbatim.
  - **(B) Poster + N evenly-spaced frames.** Better coverage; combinatorial cost when multiple videos on a page; pushes warm-path latency past 30s P95.
  - **(C) No video at all on warm path; flag pages with video for HUMAN_REVIEW.** Cheapest; loses an entire content modality (video-verifier becomes vestigial).
  - **Recommend (A).** Matches the architecture; the Q6 cost trip-wire (`FEATURE-TODO.md:55`) drops video entirely as the next escalation if (A) is still too costly — leave that lever to `profiler-real-loop.md`, do not pre-empt it here.

- **Open question — evidence storage URI scheme for `Screenshot.uri` and `VideoSample.uri`.**
  - **(A) Local filesystem (`file:///tmp/scout-evidence/{contentHash}/{idx}.png`).** Zero infra; only works while harness, profiler, and dashboard run on the same machine — true for the hackathon demo.
  - **(B) S3/GCS-compat object store.** Production shape; requires bucket setup + signed-URL handling in dashboard.
  - **(C) In-memory data-URI (`data:image/png;base64,...`) embedded directly in `PageCapture`.** No infra, no cross-process coupling — but bloats `PageCapture` past the queue's payload limit (Redis 512 MB max value but at-rest cost matters for cache; verifier prompts also pay for this in Gemini token usage if not handled).
  - **Recommend (A) for hackathon, (B) as the productionization follow-up.** Document the swap as a one-file change in `packages/harness/src/storage.ts` so the seam is preserved.

- **Open question — `contentHash` scope.**
  - **(A) DOM text + screenshot byte lengths.** Cheap to compute; stable across capture runs; sensitive enough to detect substantive page changes.
  - **(B) DOM text only.** Cheaper; misses image-only changes (a swapped hero image on the same article).
  - **(C) DOM text + screenshot perceptual hashes (`pHash`).** Robust to minor visual reflows but requires `image-hash` or similar dep; perceptual collisions blur the cache-key story.
  - **Recommend (A).** Image bytes change when the page's visual content changes; we don't need perceptual robustness for cache invalidation, just correctness.

- **Security guardrails:**
  - **`BROWSER_USE_API_KEY` lives only in `packages/harness/src/config.ts`.** The harness factory reads it; nothing else touches `process.env.BROWSER_USE_API_KEY`. Foundation's repo-wide rule (`PRPs/foundation-ad-verification.md:301`) already forbids `process.env.*` outside `config.ts`; preserve it.
  - **Never log the API key, full or fragment.** Error messages from `createHarness()` and from the SDK must not echo the key. The "API key missing" test above pins this.
  - **Tenant scoping**: harness is given a URL, not an advertiser. It does NOT enforce tenant isolation — that is the profiler's responsibility (it filters which captures it triggers, per advertiser policy). But: harness MUST NOT log or persist the URL it was asked to capture without `capturedAt`, `geo`, and the call-site identifier — a captured-URL log without provenance can leak an advertiser's prospect list.
  - **Geo-proxy fidelity**: a request that says `geo: "DE"` MUST render via a DE-region proxy. A silent fallback to a US proxy means the brand-safety verdict reflects what a US user sees, which can differ from what a DE user sees (paywalls, geo-restricted content). Test this assertion; on proxy unavailability, throw `HarnessError.UPSTREAM_DOWN` rather than capturing from a different region.
  - **No cookie/session reuse across captures.** Each `capturePage` call creates a fresh Browser session (or Agent-mode session). Reusing a session would mean a logged-in-state captured for advertiser A's request is visible in the capture for advertiser B's request on the same domain — a tenancy leak via shared browser state.
  - **Don't follow off-origin links during Agent-mode**. The Agent-mode prompt is single-page (navigate, dismiss banners, scroll, return). An LLM-driven Agent that follows arbitrary links can be coerced by the page (an injected `<a>` to a billing portal) into requesting URLs that exfiltrate state. Lock the prompt; do not parameterize navigation.
  - **No prompt-injection vector here directly** (no Gemini call), but the captured `domText` is the raw input to the verifier prompts in Cluster C. Those prompts MUST treat `domText` as untrusted; this PRP's job is to make sure `domText` is never accidentally interpreted as instructions before it reaches the verifier (e.g., do not concatenate it into a system prompt inside the harness; emit it as a structured field).

- **Gotchas:**
  - **`browser-use-sdk` Browser mode is undocumented in the npm README.** Per `PRPs/foundation-ad-verification.md:217-220`, the methods live at `src/v2/resources/browsers.ts` in `github.com/browser-use/sdk`. After `pnpm add browser-use-sdk`, inspect `node_modules/browser-use-sdk/dist/v2/resources/browsers.d.ts` for current method names — do NOT rely on the README, and do NOT rely on whatever was in the GitHub source on the PRP-write date if the installed version diverges. Pin the version in `package.json`.
  - **Gemini OpenAI compat is beta** (`PRPs/foundation-ad-verification.md:215`) — same caution applies to browser-use Cloud's API surface. Wire health-check into the smoke script so a vendor-side schema break is caught before the demo, not on stage.
  - **Volatile DOM elements break `contentHash`.** Pages with timestamps, ad-rotation slots, view counters, A/B-test flags, and CSRF tokens will produce a different hash per capture — and therefore a different `PageProfile` per bid, defeating the cache. Maintain a strip-list of element selectors (`[data-testid="ad-slot-*"]`, `meta[name="csrf-token"]`, `time[datetime]`, …) in `extract.ts`. Document the strip rule in the README; the `Determinism (insensitivity to volatile noise)` test is what catches regressions.
  - **`MAX_DOM_TEXT_BYTES = 256 KiB`** is a magic number. Export it from `extract.ts` so tests pin to the same constant; chosen to keep the verifier's Gemini Pro prompt under 200K tokens with headroom for system-prompt + categories taxonomy + screenshot embeddings.
  - **Cloud API rate limits.** browser-use Cloud has per-key concurrency caps; demo seeding (`demo-bidstream-seeding.md`) must spread captures over time, not burst all five fixtures at start. Capture a fresh test in the smoke script: 3 sequential captures must succeed; the smoke script does NOT test concurrency — that's the profiler's domain (`profiler-real-loop.md`).
  - **`opts.viewport` defaults to 1280×800.** Smaller viewports (mobile sizes) trigger different DOM (responsive pages) and different above-fold content. v1 is desktop-only; mobile is a follow-up. A demo fixture page that only shows the brand-unsafe content on mobile *will* be silently missed.
  - **Post-redirect URL vs. requested URL is a real footgun.** Cache key uses `requestedUrl` (so two bids on the same shortlink hit the same cache entry); verifiers see `url` (so they classify the actual destination, not the shortlink). Mixing them up either (a) caches the destination's profile under the redirect URL — works once, then misses every subsequent shortlink, or (b) classifies the shortlink — verifiers see no DOM. Test pins both.
  - **`videoSamples: []` vs. `null`**: schema is `[]`, never `null`. The image-verifier's "no video on this page" branch checks `videoSamples.length === 0`, not `videoSamples == null`. A `null` here would crash the verifier — schema enforcement at the boundary catches it; tests pin the empty-array shape on a video-less fixture.
  - **`AbortSignal` plumbing through `browser-use-sdk`.** The SDK may or may not respect a passed `AbortSignal` in v2; verify before relying on it for the timeout test. If it doesn't, wrap the SDK call in `Promise.race([sdkCall, timeoutReject])` and explicitly tear down the session in a `.finally()` — orphaned cloud sessions cost money.
  - **`zod.parse` on `PageCapture` at exit time** is a defense-in-depth check, but it's also a non-trivial cost on a 256 KiB `domText` + base64 screenshots structure. Use `safeParse` and re-throw a `HarnessError.UPSTREAM_DOWN` with the issue path; don't log the full failing object (PII risk in `domText`).

- **Out of scope — file as follow-ups:**
  - Mobile-viewport capture (responsive pages). v1 is desktop-only.
  - Multi-region capture for a single bid (capturing the same URL under two `geo`s and diffing). Brand-safety teams want this; v1 ships single-geo.
  - Persistent evidence store beyond local filesystem (S3/GCS swap is the option-(B) path above).
  - `creativeTags` extraction — **not harness's job**; creative tags describe the advertiser's creative, not the destination page. The gap noted at `features/clusterA/policy-match-evaluation.md:124` is closed by a different feature (creative-side handling, not yet in `FEATURE-TODO.md`).
  - Cache-warming pre-fetch (capture-on-publisher-registration). The architecture mentions it (`features/architecture.md:41`); v1 captures only on cache miss (driven by gate's enqueue from `features/clusterA/gate-verdict-logic.md:25`).
  - Self-hosted browser-use harness deployment guide. Folded into the README only if the LICENSE file allows it; otherwise filed here.
  - Perceptual image hashing for `contentHash`. v1 uses byte-length only.
  - Concurrent capture / session pooling. Belongs in `profiler-real-loop.md`, not here — harness is a single-call function.
  - PDF / non-HTML content rendering (some pages serve PDFs at the bid URL). v1 captures HTML pages only; throw `HarnessError.NAVIGATION_FAILED` on `Content-Type: application/pdf`.

- **Test order:**
  1. `PageCaptureSchema` + `CaptureOptionsSchema` shape tests first (no `capturePage` call; pins the contract; lets every later test rely on `parse()`).
  2. `Harness` interface compile-test (a `satisfies Harness` assertion on the factory return type — catches contract drift at type-check time, not test time).
  3. Browser-mode happy path against a recorded SDK mock (smallest pipeline; proves the wiring).
  4. `contentHash` determinism (same fixture twice — pin the hash value).
  5. Above-fold + scroll-sample matrix (table-driven over `sampleScrolls ∈ {0, 1, 2, 5}`).
  6. Video-present + `captureVideo: false` matrix.
  7. Geo-proxy passthrough (mock spy on `client.v2.browsers.create`).
  8. Post-redirect URL vs. requested URL.
  9. `domText` truncation boundary (255 KiB no warning; 257 KiB warns).
  10. Failure paths (timeout, BLOCKED → Agent fallback, both modes exhausted, missing API key).
  11. Schema-conformance regression (deliberately malformed mock response).
  12. Smoke script (manual; not in `pnpm test`; runs against real `BROWSER_USE_API_KEY`). Last because it's the only test that consumes a quota.
