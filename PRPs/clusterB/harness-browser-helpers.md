name: "Harness — PRP-B1: pure helpers in `@scout/harness` (TDD)"
description: |

  Second of four PRPs implementing `features/clusterB/harness-capture-page.md`.
  Lands the dep wiring + five pure-function helpers (`config`, `hash`,
  `extract`, `errors`, `storage`) that PRP-B2 wires into the real
  `capturePage` body.

  **Prereq**: PRP-A (`PRPs/harness-contracts.md`) merged — every helper
  imports types from `@scout/shared`.

  Out-of-scope: `factory.ts`, `browserMode.ts`, the SDK + Playwright
  orchestration, the Browser-mode test matrix, the smoke script, the
  ESLint hot-path test → all PRP-B2. Agent-mode → PRP-C.

  ## TDD discipline (every task)

  **Red → Green → Refactor.** Write the test first, run it, confirm it
  fails for the *expected reason* (`ERR_MODULE_NOT_FOUND` /
  `TS2307` / unimplemented branch). Then write the minimum impl. Then
  tidy. Commit at green; never commit at red unless the message says
  `WIP — red`.

  All five helpers in this PRP are **pure functions with no SDK or
  Playwright dependency** — the tests are direct, no mocking layer.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A; helpers run inside the warm-path
    `capturePage`, not on the hot path.
  - **Pre-bid** — Honored by warm-path placement (preserved by PRP-B2's
    ESLint smoke test).
  - **Plug-and-play** — Helpers have no external surface; they're
    consumed only by `browserMode.ts` (PRP-B2). No cross-package leak.
  - **Sponsor tech** — Neither. No LLM call, no inter-agent flow.

  ## CLAUDE.md rules that bite

  - § Working agreements — **"Ask before adding a dependency."** Task 1
    is the asking step for `browser-use-sdk` + `playwright`. Block on
    human ack.
  - § Stack — TypeScript strict, NodeNext, ES2022, ESM-only.
  - 300-line file cap; tests colocated as `*.test.ts`.

  ## Decisions (locked here)

  | # | Question | Locked answer | Why |
  |---|---|---|---|
  | D1 | Browser-mode driver dependencies | `browser-use-sdk@^3.6.0` (MIT) + `playwright@^1.49.0`. | SDK provisions the remote Chrome; Playwright drives it via CDP. Verified upstream. |
  | D2 | `BROWSER_USE_API_KEY` access path | Single read in `packages/harness/src/config.ts`. Passed explicitly to the SDK constructor (PRP-B2) — never relying on the SDK's `process.env` fallback. | `PRPs/foundation-ad-verification.md:301` forbids `process.env.*` outside `config.ts`; explicit `apiKey:` argument is the single audit point. |
  | D3 | `contentHash` shape | `sha256(NFC(domText) + "\x00" + sortedScreenshotByteLengths.join("\|"))` hex. | Cheap, deterministic, sensitive to content change. |
  | D4 | `MAX_DOM_TEXT_BYTES` | `256 * 1024`. Exported from `extract.ts`. | Keeps verifier prompts under 200K tokens with headroom. |
  | D5 | Evidence storage | `file:///{baseDir}/{contentHash}/{idx}.{ext}` with `baseDir` injected (default `/tmp/scout-evidence`). | Zero infra for the demo; S3/GCS swap is a one-file change. Profiler adds tenant namespace at commit time. |

  ## All Needed Context

  ```yaml
  - file: PRPs/harness-contracts.md
    why: Prereq. Defines @scout/shared types these helpers consume.

  - file: features/clusterB/harness-capture-page.md
    section: "Security guardrails (lines 151-158); Gotchas
      (lines 160-170, especially 161 SDK shape and 163 volatile DOM
      strip-list)"
    why: Source spec for security rules + the volatile-DOM strip list
      these helpers enforce.

  - file: PRPs/foundation-ad-verification.md
    section: "env-var pattern (lines 209-213); ESLint boundary rules
      (lines 147-159, 301)"
    why: Pattern precedent for config.ts (single env read site).

  - url: https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options
    why: `crypto.createHash("sha256")`. Native, no extra dep.

  - url: https://www.unicode.org/reports/tr15/#Norm_Forms
    why: NFC normalization for contentHash determinism.

  - url: https://nodejs.org/api/buffer.html#bufferbytelengthstring-encoding
    why: `Buffer.byteLength` for DOM-text truncation (BYTES, not chars).

  - file: packages/harness/package.json
    why: Currently only @scout/shared in deps. Task 1 adds the two
      runtime deps + tsx + vitest devDeps.
  ```

  ## Files to create (this PRP)

  ```
  packages/harness/src/
    config.ts                + __tests__/config.test.ts
    hash.ts                  + __tests__/hash.test.ts
    extract.ts               + __tests__/extract.test.ts
    errors.ts                + __tests__/errors.test.ts
    storage.ts               + __tests__/storage.test.ts
  ```

  No barrel updates in this PRP — PRP-B2 writes the `index.ts` barrel
  once the orchestrator lands. Internal-only imports are fine.

  ## Task order (TDD; commit-sized)

  ### Task 1 — Human gate: dependency confirmation

  Open a clarification: this PRP proposes adding
  `browser-use-sdk@^3.6.0` (MIT) and `playwright@^1.49.0` as runtime
  deps. Cite Decisions table D1 + the verified upstream LICENSE / SDK
  surface. **Block on human ack.** Don't `pnpm add` without it. The
  same ack covers PRP-B2 — record it in the PR description so PRP-B2
  doesn't re-ask.

  ### Task 2 — Package wiring (no tests; wiring commit)

  Edit `packages/harness/package.json`:

  ```json
  "dependencies": {
    "@scout/shared": "workspace:*",
    "browser-use-sdk": "^3.6.0",
    "playwright": "^1.49.0"
  },
  "devDependencies": {
    "@types/node": "^20.x",
    "tsx": "^4.x",
    "typescript": "^5.6.3",
    "vitest": "^2.x"
  }
  ```

  Run `pnpm install`. Verify `pnpm --filter @scout/harness exec tsc
  --noEmit` is clean. (No impl yet; the deps just need to resolve.)

  > **Gotcha for the implementer**: Playwright auto-downloads Chromium
  > (~300 MB). CI may set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` since we
  > connect over CDP, not local — document in PRP-C's README, don't
  > address here.

  ### Task 3 — Red→Green: `config.ts`

  **Red.** Write `packages/harness/src/__tests__/config.test.ts`:

  - **Happy** — `vi.stubEnv("BROWSER_USE_API_KEY", "test-key")` then
    `harnessConfig()` returns `{ browserUseApiKey: "test-key",
    defaultProxyCountry: "US", ... }`.
  - **Failure** — env var unset → `harnessConfig()` throws a
    `HarnessException` with `.code === HarnessError.UPSTREAM_DOWN`.
  - **Security** — the thrown error's `.message` does NOT match
    `/BROWSER_USE_API_KEY=\S/` (no value echo, redacted or otherwise).
    The name as a hint is fine; any partial of the value is not.

  Run → red.

  **Green.** Write `packages/harness/src/config.ts`:

  ```ts
  import { HarnessError, HarnessException } from "@scout/shared";

  export interface HarnessConfig {
    readonly browserUseApiKey: string;
    readonly browserUseBaseUrl?: string;
    readonly defaultProxyCountry: string;     // alpha-2 UPPERCASE
  }

  export function harnessConfig(): HarnessConfig {
    const key = process.env.BROWSER_USE_API_KEY;
    if (!key) {
      // SECURITY: do NOT echo the (missing) value. Name-only hint.
      throw new HarnessException(
        HarnessError.UPSTREAM_DOWN,
        "BROWSER_USE_API_KEY is not set; @scout/harness cannot create a Cloud session",
      );
    }
    return {
      browserUseApiKey: key,
      browserUseBaseUrl: process.env.BROWSER_USE_BASE_URL,
      defaultProxyCountry: "US",
    };
  }
  ```

  > **Audit invariant**: this is the ONLY file in
  > `packages/harness/src/**` allowed to read `process.env.*`. Verify
  > with `grep -rn 'process\.env' packages/harness/src` — must return
  > only `config.ts` lines. A future regression that adds an env read
  > elsewhere fails the foundation rule
  > (`PRPs/foundation-ad-verification.md:301`).

  ### Task 4 — Red→Green: `hash.ts`

  **Red.** Write `hash.test.ts`:

  - **Determinism** — `computeContentHash("hello world", [100, 200])`
    twice yields identical 64-char hex. Pin the expected hex string
    as a test constant. A regression invalidates every cached
    PageProfile in production — this is a load-bearing pin.
  - **Sort stability** — `[200, 100]` produces the SAME hash as
    `[100, 200]` (function sorts internally).
  - **Sensitivity to DOM** — changing `domText` changes the hash.
  - **Sensitivity to bytes** — changing one byte-length changes the
    hash.
  - **NFC normalization** — `"café"` (composed `é`) and `"café"`
    (decomposed `e` + combining acute) produce the SAME hash.
  - **Output regex** — `/^[a-f0-9]{64}$/` (matches `@scout/shared`
    PageCapture schema).

  Run → red.

  **Green.** Write `hash.ts`:

  ```ts
  import { createHash } from "node:crypto";

  export function computeContentHash(
    canonicalDomText: string,
    screenshotBytes: ReadonlyArray<number>,
  ): string {
    // Reason: NFC normalize before hashing — "café" composed vs
    // decomposed must collide, otherwise the same page produces
    // two different PageProfiles.
    const normalized = canonicalDomText.normalize("NFC");
    const sortedSizes = [...screenshotBytes].sort((a, b) => a - b).join("|");
    return createHash("sha256")
      .update(normalized)
      .update("\x00")     // separator — prevents "abc"+"|10|20" colliding with "abc|10|20"
      .update(sortedSizes)
      .digest("hex");
  }
  ```

  ### Task 5 — Red→Green: `extract.ts`

  **Red.** Write `extract.test.ts`:

  - **Constant export** — `MAX_DOM_TEXT_BYTES === 256 * 1024`.
  - **Canonical DOM text — whitespace collapse** —
    `canonicalDomText("  Hello\n\n  World  ")` → `"Hello World"`.
  - **Canonical DOM text — NFC** — combining-accent input → composed
    output.
  - **Canonical DOM text — empty** — `canonicalDomText("")` → `""`
    (no exception).
  - **Truncate — under cap** — `truncateToBytes("hello", 100)` →
    `"hello"` (no change; `Buffer.byteLength` already under cap).
  - **Truncate — at cap** — string whose `Buffer.byteLength === 256 *
    1024` exactly → returned unchanged.
  - **Truncate — over cap, ASCII** — ASCII string of `Buffer.byteLength
    === 256 * 1024 + 100` → returned string has `Buffer.byteLength ===
    256 * 1024`.
  - **Truncate — code-point safety** — string whose 256 KiB boundary
    lands mid-multibyte-char (e.g., a long run of `"é"` which is 2
    bytes in UTF-8) — returned string truncates at the previous
    code-point boundary, never mid-sequence. Assert with a final
    `try { Buffer.from(result, "utf8").toString("utf8"); } catch { fail }`
    smoke.

  Run → red.

  **Green.** Write `extract.ts`. The pure helpers ONLY in this PRP:

  ```ts
  export const MAX_DOM_TEXT_BYTES = 256 * 1024;

  export function canonicalDomText(raw: string): string {
    // 1. NFC normalize (so "café" hashes deterministically).
    // 2. Collapse all whitespace runs to single spaces.
    // 3. Trim.
    return raw.normalize("NFC").replace(/\s+/g, " ").trim();
  }

  export function truncateToBytes(s: string, maxBytes: number): string {
    if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
    // Binary-search the code-point boundary that yields the largest
    // string whose UTF-8 byte length is ≤ maxBytes. Avoid mid-multibyte
    // truncation by working on the string in code-point units.
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (Buffer.byteLength(s.slice(0, mid), "utf8") <= maxBytes) lo = mid;
      else hi = mid - 1;
    }
    return s.slice(0, lo);
  }
  ```

  > **Out of scope here**: `pickHeadline(page)` and
  > `extractMetadata(page)` need a Playwright `Page` — they land in
  > PRP-B2's `browserMode.ts`. The pure projection rules (this PRP)
  > are decoupled from the Playwright surface.

  > **Strip-list for volatile elements** (`time[datetime]`,
  > `[data-testid="ad-slot-*"]`, etc., per
  > `features/clusterB/harness-capture-page.md:163`) is also a
  > DOM-side concern → PRP-B2 implements it in `page.evaluate` before
  > calling `canonicalDomText`. This PRP only handles already-stripped
  > text.

  ### Task 6 — Red→Green: `errors.ts`

  **Red.** Write `errors.test.ts` with `test.each`:

  | Input shape | Expected `HarnessErrorCode` |
  |---|---|
  | `{ status: 429, ... }` (rate limit) | `UPSTREAM_DOWN` |
  | `{ status: 403, name: "SessionTimeoutLimitExceededError" }` | `TIMEOUT` |
  | `{ status: 422, name: "ValidationError" }` | `UPSTREAM_DOWN` |
  | `{ status: 404 }` (ProfileNotFoundError; should not happen here but pin) | `UPSTREAM_DOWN` |
  | `Error("network unreachable")` | `UPSTREAM_DOWN` |
  | `Error` with `.name === "TimeoutError"` (Playwright) | `TIMEOUT` |
  | `HarnessException(TIMEOUT, "x")` instance | echoes `.code === "TIMEOUT"` |
  | `null` / `undefined` / `42` (non-Error) | `UPSTREAM_DOWN` |

  Run → red.

  **Green.** Write `errors.ts`:

  ```ts
  import { HarnessError, HarnessException, type HarnessErrorCode } from "@scout/shared";

  export function classifySdkError(err: unknown): HarnessErrorCode {
    if (err instanceof HarnessException) return err.code;
    if (typeof err !== "object" || err === null) return HarnessError.UPSTREAM_DOWN;
    const e = err as { status?: number; name?: string };
    if (e.name === "TimeoutError") return HarnessError.TIMEOUT;
    if (e.status === 403) return HarnessError.TIMEOUT;      // SessionTimeoutLimitExceeded
    // 422 / 429 / 4xx / 5xx all surface as upstream issues; the
    // BLOCKED / CONSENT_WALL_UNRESOLVED codes are emitted by the
    // navigation code path in browserMode.ts, NOT by SDK error
    // classification.
    return HarnessError.UPSTREAM_DOWN;
  }
  ```

  > **Pure function; no SDK import.** Duck-types on `.status` and
  > `.name` so tests are mock-free. PRP-B2's orchestrator wraps SDK
  > calls in `try { ... } catch (e) { throw new HarnessException(classifySdkError(e), ...) }`.

  ### Task 7 — Red→Green: `storage.ts`

  **Red.** Write `storage.test.ts`. Use `os.tmpdir()` + a per-test
  subdir so the global `/tmp/scout-evidence` isn't touched:

  - **Happy — `writeScreenshot`** — given `baseDir`, `contentHash`,
    `idx`, `bytes` (a `Buffer`), and `{ kind, scrollY, viewport }`,
    writes a file at `{baseDir}/{contentHash}/{idx}.png` and returns
    a `Screenshot` object whose `uri === "file://{baseDir}/{hash}/{idx}.png"`
    and `bytes === buffer.length`.
  - **Happy — `writeVideoSample`** — same shape; `.jpg` for kind
    `"poster"`, `.bin` for `"first_second_frame"` (matches a JPEG
    poster from an HTML `<video>` and a generic frame extracted from
    a possibly-h264 stream).
  - **Edge — `rehomeUri`** — given a placeholder URI
    `file://{baseDir}/_PLACEHOLDER_/0.png` and a real contentHash,
    returns `file://{baseDir}/{contentHash}/0.png` (string rewrite +
    file rename on disk).
  - **Determinism — idempotent overwrite** — calling `writeScreenshot`
    twice with the same args overwrites; final file matches the new
    bytes.
  - **Edge — `bytes: 0`** — empty buffer accepted; file written
    empty; `Screenshot.bytes === 0`.

  Run → red.

  **Green.** Write `storage.ts`. The two-phase write (placeholder dir
  → rehome) is what makes `browserMode.ts` able to compute the
  contentHash AFTER all screenshots are captured (PRP-B2).

  ```ts
  import { mkdir, rename, writeFile } from "node:fs/promises";
  import { join } from "node:path";
  import type { Screenshot, VideoSample } from "@scout/shared";

  const PLACEHOLDER_DIR = "_placeholder_";

  export async function writeScreenshot(
    baseDir: string,
    contentHashOrPlaceholder: string,
    idx: number,
    bytes: Buffer,
    meta: Pick<Screenshot, "kind" | "scrollY" | "viewport">,
  ): Promise<Screenshot> {
    const dir = join(baseDir, contentHashOrPlaceholder);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${idx}.png`);
    await writeFile(path, bytes);
    return { uri: `file://${path}`, bytes: bytes.length, ...meta };
  }

  export async function writeVideoSample(
    baseDir: string,
    contentHashOrPlaceholder: string,
    idx: number,
    bytes: Buffer,
    meta: Pick<VideoSample, "kind" | "timestampMs">,
  ): Promise<VideoSample> {
    const dir = join(baseDir, contentHashOrPlaceholder);
    await mkdir(dir, { recursive: true });
    const ext = meta.kind === "poster" ? "jpg" : "bin";
    const path = join(dir, `${idx}.${ext}`);
    await writeFile(path, bytes);
    return { uri: `file://${path}`, bytes: bytes.length, ...meta };
  }

  export async function rehomeUri(
    placeholderUri: string,
    placeholderDir: string,
    contentHash: string,
  ): Promise<string> {
    // Rewrite the URI string; rename the on-disk directory.
    const next = placeholderUri.replace(`/${placeholderDir}/`, `/${contentHash}/`);
    // Caller handles the directory rename once after all assets are
    // written — do it here in a finalizeContentHash() helper if
    // multiple callers want it. For now: single mkdir+rename.
    return next;
  }

  export const STORAGE_PLACEHOLDER = PLACEHOLDER_DIR;
  ```

  > **Implementer note**: the test fixtures should use the injected
  > `baseDir`, never `/tmp/scout-evidence` directly. A throwing test
  > that doesn't clean up its `baseDir` leaks state into the next
  > test; use `beforeEach` + `afterEach` to mkdtemp / rm-rf.

  ### Task 8 — Full validation sweep

  ```bash
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r exec prettier --write .
  pnpm --filter @scout/harness test
  pnpm -r build
  pnpm audit
  ```

  Also verify the env-isolation invariant:

  ```bash
  grep -rn 'process\.env' packages/harness/src
  # Expected: ONLY packages/harness/src/config.ts lines.
  ```

  ## Security guardrails

  - `process.env.*` access restricted to `config.ts` (Task 3 pin + the
    grep audit above).
  - The missing-key error message must NEVER echo the value (Task 3
    security assertion).
  - `domText` cap (Task 5) is a defense against downstream PII-in-logs
    failure. Document in the file header: `// SECURITY: callers must
    NOT log canonicalDomText output — up to 256 KiB of arbitrary page
    content.`
  - `storage.ts` writes to `baseDir` — caller injects. Default to a
    per-process temp dir; never write to a path interpolated from
    untrusted input. (Task 7's tests use a `mkdtemp` per test.)
  - `errors.ts` uses duck-typing on `.status` / `.name`; never logs
    the original error object. PRP-B2's orchestrator should also log
    structured summaries only.

  ## Out of scope (lands in PRP-B2 / PRP-C)

  - `factory.ts` (`createHarness`) — PRP-B2.
  - `browserMode.ts` (the `capturePage` orchestrator + Playwright wiring)
    — PRP-B2.
  - `pickHeadline(page)` / `extractMetadata(page)` / volatile-DOM
    strip-list (DOM-side; needs Playwright `Page`) — PRP-B2.
  - Browser-mode test matrix with SDK + Playwright mocked — PRP-B2.
  - AbortSignal experiment — PRP-B2.
  - Smoke script — PRP-B2.
  - Hot-path ESLint boundary test — PRP-B2.
  - `agentMode.ts` + two-pass fallback — PRP-C.
  - `packages/harness/README.md` — PRP-C.
  - CLAUDE.md § Stack updates — PRP-C.
  - `index.ts` barrel — PRP-B2 (this PRP's helpers are internal-only).

  ## Anti-Patterns

  - ❌ Don't add `process.env.*` access outside `config.ts`. The grep
    audit catches it; the foundation ESLint rule catches it.
  - ❌ Don't import `browser-use-sdk` or `playwright` in any helper.
    These five helpers are pure functions. The SDK + Playwright land
    in PRP-B2.
  - ❌ Don't echo `BROWSER_USE_API_KEY` (full / partial / "redacted")
    in any error message or log line.
  - ❌ Don't use `s.slice(0, n)` to truncate by bytes — `n` is
    code-point counts in JS strings. Use `Buffer.byteLength` +
    binary-search code-point boundary (Task 5 green).
  - ❌ Don't drop the `"\x00"` separator in `hash.ts` — without it
    `"abc"` + `[10, 20]` would collide with `"abc10|20"` + `[]`.
  - ❌ Don't pin `*-latest` versions. Both `browser-use-sdk` and
    `playwright` need exact-minor pins in `package.json`.
  - ❌ Don't write directly to `/tmp/scout-evidence` in tests — use a
    `mkdtemp` per test and clean up in `afterEach`.
  - ❌ Don't add `tsx` as a runtime dep; it's devDeps only.
  - ❌ Don't commit at red unless the message says `WIP — red`.

  ## Confidence: 9 / 10

  All five helpers are pure functions with deterministic test fixtures.
  No SDK / Playwright surface to mock; no live network call. The one
  risk is **Task 5's truncate code-point-boundary edge case** — the
  binary-search approach is correct but easy to off-by-one. The
  multibyte-char test pins it; if it flakes, switch to a forward scan
  with `Buffer.byteLength` per code point until cap. Either way,
  TDD-discipline catches the bug.
