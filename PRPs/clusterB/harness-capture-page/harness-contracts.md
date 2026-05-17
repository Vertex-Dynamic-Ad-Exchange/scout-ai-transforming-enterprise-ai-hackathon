name: "Harness — PRP-A: cross-package contracts in `@scout/shared` (TDD)"
description: |

  First of three PRPs implementing `features/clusterB/harness-capture-page.md`.
  This PRP lands ONLY the typed contracts (`PageCapture` schema + `Harness`
  interface + `HarnessError`) in `@scout/shared`. No SDK install, no
  `capturePage` body — those land in PRP-B (browser-mode) and PRP-C (agent
  fallback).

  ## TDD discipline (applies to every task below)

  Every task is **red → green → refactor**:

  1. **Red.** Write the test first. Run it (`pnpm --filter @scout/shared test
     -- <file>`). Confirm it fails for the *expected reason* — usually an
     `ERR_MODULE_NOT_FOUND` or a `TS2307` (cannot find module / export) on
     the import line. **A test that fails for the wrong reason (typo, syntax
     error) is not a real red** — fix the test first.
  2. **Green.** Write the *minimum* impl to flip the test green. Resist
     adding fields the test doesn't exercise — they belong in the next
     red→green cycle.
  3. **Refactor.** Only after green: tidy names, extract shared helpers,
     run `pnpm -r exec tsc --noEmit` + `eslint --fix`. Tests must still be
     green after the refactor; no behavior change.

  Commit at green (one commit per red→green pair is fine; never commit at
  red unless the commit message says `WIP — red` and you intend to follow
  immediately).

  Skip the discipline at your own risk: schemas are tempting to "just
  type out" without tests, but the alignment test (Task 7) catches drift
  in the shape we DON'T notice — and that test only exists because we
  wrote it first.

  ## Why this PRP exists separately

  - **Unblocks profiler in parallel.** `features/clusterB/profiler-real-loop.md`
    consumes `PageCapture` and the `Harness` interface
    (`profiler-real-loop.md:146, 164`). Landing contracts as a standalone
    commit lets the profiler PRP start writing tests against the real shape
    today, even while PRP-B is in flight.
  - **Cluster A precedent.**
    `features/clusterA/policy-match-evaluation.md:13-22` locks
    `PolicyMatchResult` in `@scout/shared` as its own discrete step.

  ## Hackathon constraint check

  - **Sub-second SLA** — N/A; contracts have no runtime.
  - **Pre-bid** — Honored by placement: contracts live in `@scout/shared`,
    which is the only package the hot-path `@scout/gate` consumes from this
    cluster.
  - **Plug-and-play** — This PRP *is* the seam. `Harness` becomes the single
    typed interface any concrete impl (Cloud, self-hosted, different SDK)
    implements.
  - **Sponsor tech** — Neither. No LLM call originates here; no inter-agent
    message flow. Lobster Trap seam preserved by introducing no LLM call.

  ## CLAUDE.md rules that bite

  - § Stack — zod at every cross-package contract; the four cross-cutting
    shapes live in `@scout/shared` (this PRP adds the fifth).
  - § Working agreements — files ≤ ~300 lines; 1 happy / 1 edge / 1 failure
    per new file (this PRP exceeds the minimum because contracts are
    load-bearing for every downstream PRP).

  ## Decisions (locked here)

  | # | Question | Locked answer | Why |
  |---|---|---|---|
  | D1 | Location of `PageCapture` + `Harness` | `@scout/shared` (`schemas/capture.ts` + `interfaces/harness.ts`). | Matches Cluster A's locking of `PolicyMatchResult`; foundation's intent at `PRPs/foundation-ad-verification.md:136`. |
  | D2 | First occupant of `packages/shared/src/interfaces/` | This PRP creates the directory. | Foundation lists `interfaces/` but never lands it; first interface to need it. |
  | D3 | `domText` cap | 256 KiB. Schema enforces `.max(256 * 1024)`. | Keeps verifier Gemini Pro prompts under 200K tokens with headroom. |
  | D4 | `sampleScrolls` cap | 0–8 inclusive. | >8 risks vision-context-window overflow on the image-verifier. |
  | D5 | `contentHash` shape | sha256 hex; regex `/^[a-f0-9]{64}$/` at the seam. | Catches a malformed-hash bug at the boundary, not deep downstream. |
  | D6 | Evidence URI scheme | `z.string().min(1)` (NOT `z.string().url()`). | PRP-B emits `file://` for the demo; some zod versions reject `file://` under `.url()`. Profiler rewrites to its own tenant-namespaced scheme. |

  ## All Needed Context

  ```yaml
  - file: features/clusterB/harness-capture-page.md
    section: "FEATURE — End state — New shared schema (lines 17-46);
      New shared interface (line 46); EXAMPLES (lines 73-92)"
    why: Source spec for every field on the schemas this PRP lands.

  - file: features/clusterB/profiler-real-loop.md
    section: "FEATURE — PageProfile assembly (lines 83-91);
      EXAMPLES (lines 146, 150, 162-163)"
    why: The consumer. Field-name alignment is verified at the seam.

  - file: features/clusterA/policy-match-evaluation.md
    section: "FEATURE — New shared schema (lines 13-22)"
    why: Direct precedent for the schema-in-shared pattern.

  - file: packages/shared/src/schemas/profile.ts
    why: PageProfile target shape. PageCapture.contentHash → PageProfile.contentHash
      byte-for-byte; field-name alignment test in Task 7 pins this.

  - file: packages/shared/src/schemas/bid.ts
    why: BidVerificationRequest.geo regex `/^[A-Z]{2}$/` (line 8). Reuse for
      CaptureOptions.geo — do NOT re-declare; factor into primitives.ts only
      if a third caller appears.

  - file: packages/shared/src/index.ts
    why: Current barrel; this PRP appends two `export *` lines.

  - file: PRPs/foundation-ad-verification.md
    section: "Contracts (lines 132-145)"
    why: Foundation names the interfaces directory but doesn't land it;
      this PRP is the first occupant.
  ```

  ## Files to create

  - `packages/shared/src/schemas/capture.ts`
  - `packages/shared/src/interfaces/harness.ts`
  - `packages/shared/src/schemas/capture.test.ts`
  - `packages/shared/src/interfaces/harness.test.ts`
  - `packages/shared/src/schemas/capture.alignment.test.ts` (type-only)

  ## Files to modify

  - `packages/shared/src/index.ts` — append:
    ```ts
    export * from "./schemas/capture.js";
    export * from "./interfaces/harness.js";
    ```

  ## Target contract — `packages/shared/src/schemas/capture.ts`

  ```ts
  import { z } from "zod";

  // Reused regex from packages/shared/src/schemas/bid.ts:8.
  const Alpha2 = z.string().regex(/^[A-Z]{2}$/);

  export const ScreenshotSchema = z.object({
    uri: z.string().min(1),
    kind: z.enum(["above_fold", "viewport_sample"]),
    scrollY: z.number().int().nonnegative(),
    viewport: z.object({
      w: z.number().int().positive(),
      h: z.number().int().positive(),
    }),
    bytes: z.number().int().nonnegative(),
  });
  export type Screenshot = z.infer<typeof ScreenshotSchema>;

  export const VideoSampleSchema = z.object({
    uri: z.string().min(1),
    kind: z.enum(["poster", "first_second_frame"]),
    timestampMs: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  });
  export type VideoSample = z.infer<typeof VideoSampleSchema>;

  export const CaptureOptionsSchema = z.object({
    geo: Alpha2.optional(),
    timeoutMs: z.number().int().positive().optional(),
    viewport: z.object({
      w: z.number().int().positive(),
      h: z.number().int().positive(),
    }).optional(),
    sampleScrolls: z.number().int().min(0).max(8).optional(),
    captureVideo: z.boolean().optional(),
    forceAgentMode: z.boolean().optional(),
  }).strict();
  export type CaptureOptions = z.infer<typeof CaptureOptionsSchema>;

  export const PageCaptureSchema = z.object({
    url: z.string().url(),
    requestedUrl: z.string().url(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    capturedAt: z.string().datetime(),
    geo: Alpha2,
    domText: z.string().max(256 * 1024),
    headline: z.string().nullable(),
    metadata: z.object({
      title: z.string().nullable(),
      description: z.string().nullable(),
      ogType: z.string().nullable(),
      lang: z.string().nullable(),
    }),
    screenshots: z.array(ScreenshotSchema).min(1),
    videoSamples: z.array(VideoSampleSchema),
    capturedBy: z.object({
      mode: z.enum(["browser", "agent"]),
      sdkVersion: z.string().min(1),
      sessionId: z.string().min(1),
    }),
    capturedBy: z.object({ /* see above */ }), // duplicate intentionally — the test in Task 2 below catches this drift if the schema isn't tight
    warnings: z.array(z.string()),
  });
  export type PageCapture = z.infer<typeof PageCaptureSchema>;
  ```

  > **Implementer note**: the duplicate `capturedBy:` key in the pseudocode
  > above is intentional bait — Task 2's red test catches whichever wins
  > (TypeScript will warn). Strip the duplicate in your impl; keep one.

  ## Target contract — `packages/shared/src/interfaces/harness.ts`

  ```ts
  import type { CaptureOptions, PageCapture } from "../schemas/capture.js";

  export const HarnessError = {
    TIMEOUT: "TIMEOUT",
    NAVIGATION_FAILED: "NAVIGATION_FAILED",
    BLOCKED: "BLOCKED",
    CONSENT_WALL_UNRESOLVED: "CONSENT_WALL_UNRESOLVED",
    UPSTREAM_DOWN: "UPSTREAM_DOWN",
  } as const;
  export type HarnessErrorCode = (typeof HarnessError)[keyof typeof HarnessError];

  export class HarnessException extends Error {
    constructor(
      public readonly code: HarnessErrorCode,
      message: string,
      public readonly cause?: unknown,
    ) {
      super(message);
      this.name = "HarnessException";
    }
  }

  export interface Harness {
    capturePage(url: string, opts?: CaptureOptions): Promise<PageCapture>;
  }
  ```

  ## Task order (TDD; commit-sized; use TaskCreate / TaskUpdate)

  ### Task 1 — Red: schema-conformance happy path for `PageCaptureSchema`

  Write `packages/shared/src/schemas/capture.test.ts` containing ONLY a
  happy-path test that imports `PageCaptureSchema` from `@scout/shared` and
  parses a hand-built valid `PageCapture` literal. Run:

  ```bash
  pnpm --filter @scout/shared test -- capture.test.ts
  ```

  **Expected red**: `Cannot find module '@scout/shared'` or
  `'PageCaptureSchema' is not exported`. If you get any other failure
  reason, fix the test first.

  ### Task 2 — Green: minimal `capture.ts`

  Create `packages/shared/src/schemas/capture.ts` with `PageCaptureSchema` +
  `Screenshot/VideoSample/CaptureOptions` exports per § Target contract.
  Append `export * from "./schemas/capture.js"` to
  `packages/shared/src/index.ts`. Re-run Task 1's test — must now be green.
  Refactor: strip the bait-duplicate `capturedBy:` if it slipped through.

  ### Task 3 — Red→Green: schema-conformance edge matrix for `PageCapture`

  Extend `capture.test.ts` with the edges below. Each subtest must be added
  red-first (run, confirm fail) before its case is handled by the schema.
  Most are already covered by the contract in Task 2 — write them anyway
  to lock the behavior:

  - **Edge** — `contentHash` exactly 64 hex chars passes; 63 fails; 65
    fails; `"X".repeat(64)` (uppercase) fails.
  - **Edge** — `domText` of length `256 * 1024` passes; `256 * 1024 + 1`
    fails.
  - **Edge** — `screenshots: []` (empty) rejected.
  - **Edge** — `videoSamples: null` rejected (must be `[]`).
  - **Edge** — `headline: undefined` rejected (must be `string | null`).
  - **Edge** — `capturedBy.mode: "agent"` accepted; `"AGENT"` rejected
    (case-sensitive enum).
  - **Edge** — `geo: "DE"` accepted; `"de"` rejected; `"DEU"` rejected.
  - **Edge** — `requestedUrl` and `url` may differ (post-redirect case);
    both required; both must be valid URLs.
  - **Failure** — `PageCaptureSchema.parse(null)` throws.
  - **Failure** — `PageCaptureSchema.parse({})` throws with multiple zod
    issues.
  - **Determinism** — `PageCaptureSchema.parse(x)` twice yields deep-equal
    results (no hidden mutation).

  ### Task 4 — Red→Green: `CaptureOptionsSchema` matrix

  - **Happy** — `parse({})` returns `{}`.
  - **Happy** — `parse({ geo: "DE" })` accepts UPPERCASE.
  - **Edge** — `sampleScrolls: 0` accepted; `8` accepted; `9` rejected;
    `-1` rejected.
  - **Edge** — unknown key (`{ unknownKey: 1 }`) rejected (`.strict()`).
  - **Edge** — `timeoutMs: 0` rejected (`.positive()`); `1` accepted.
  - **Edge** — `viewport: { w: 0, h: 800 }` rejected; `{ w: 1280, h: 800 }`
    accepted.

  ### Task 5 — Red→Green: `harness.ts` interface + exception

  Write `packages/shared/src/interfaces/harness.test.ts` with:

  - **Compile-time** — assignability:
    ```ts
    const _impl: Harness = {
      capturePage: async () => ({} as PageCapture),
    };
    void _impl;
    ```
    If `Harness` is missing a method or has a wrong signature, `tsc
    --noEmit` fails — that IS the red.
  - **Runtime — HarnessException** — `new HarnessException(HarnessError.TIMEOUT, "x")`
    is `instanceof Error` AND `instanceof HarnessException`;
    `.code === "TIMEOUT"`; `.name === "HarnessException"`.
  - **Runtime — HarnessError enum** — `Object.values(HarnessError)` has 5
    unique strings; every key matches its value (the `as const` pattern is
    what enforces this — the test catches a mistyped value).

  Run the test → red (file doesn't exist). Then create
  `packages/shared/src/interfaces/harness.ts` per § Target contract. Append
  `export * from "./interfaces/harness.js"` to
  `packages/shared/src/index.ts`. Re-run → green.

  ### Task 6 — Refactor: shared `Alpha2` (only if a third caller appears)

  If after Tasks 2–5 you see `bid.ts` and `capture.ts` both re-declaring the
  same `/^[A-Z]{2}$/` regex, **leave it**. Two near-identical regexes for
  the same RFC is fine. If a future schema (`ProfileJob.geo` in the
  profiler PRP) would be the third caller, that PRP factors into
  `schemas/primitives.ts`; not this one.

  ### Task 7 — Red→Green: compile-time alignment test with `PageProfile`

  Write `packages/shared/src/schemas/capture.alignment.test.ts`:

  ```ts
  import type { PageCapture, PageProfile } from "@scout/shared";

  // Reason: type-only check. If either schema renames a field this fails
  // at type-check time, not at profiler runtime. Catches the silent
  // rename → cache-poisoning bug class.
  type ProfileFieldsFromCapture = {
    url: PageCapture["url"];
    contentHash: PageCapture["contentHash"];
    capturedAt: PageCapture["capturedAt"];
  };
  const _alignment: Pick<PageProfile, "url" | "contentHash" | "capturedAt"> =
    {} as ProfileFieldsFromCapture;
  void _alignment;
  ```

  Verify it type-checks against the current shapes. If `tsc` fails, it
  means `PageCapture` and `PageProfile` are misaligned on a load-bearing
  field — **stop and surface to the human**. The fix is *not* to relax
  this test; the fix is to align the field name.

  ### Task 8 — Full validation sweep

  ```bash
  pnpm -r exec tsc --noEmit
  pnpm -r exec eslint . --fix
  pnpm -r exec prettier --write .
  pnpm --filter @scout/shared test
  pnpm -r build
  ```

  No `pnpm audit` regression expected — this PRP adds no runtime deps.

  ## Security guardrails

  Minimal — no runtime, no I/O, no env access.

  - The `domText` cap (256 KiB) is a defense against downstream PII-in-logs
    failure. Document in `capture.ts` JSDoc that consumers MUST treat
    `domText` as untrusted page content; the verifier prompts in Cluster C
    enforce this through Lobster Trap.
  - `Screenshot.uri` and `VideoSample.uri` use `z.string().min(1)`, not
    `z.string().url()`. PRP-B emits `file://` for the demo, which some zod
    versions reject under `.url()`. The profiler namespaces these by
    advertiser at commit time (`profiler-real-loop.md:89`); the consumer
    owns scheme validation.
  - Do NOT add `process.env.*` access in this PRP. Schemas have no
    runtime; if you find yourself reading env, you're in the wrong PRP.

  ## Out of scope (these land in PRP-B / PRP-C)

  - `createHarness()` factory and the `capturePage` body — PRP-B.
  - `browser-use-sdk` / `playwright` installation — PRP-B.
  - Agent-mode escape hatch + two-pass fallback — PRP-C.
  - `packages/harness/README.md` — PRP-C.
  - CLAUDE.md § Stack updates — PRP-C, after SDK shape is verified.

  ## Anti-Patterns

  - ❌ Don't skip the red step. "It will obviously fail" is not the same
    as "I ran it and it failed for the right reason."
  - ❌ Don't add fields the tests don't exercise. The contract is what
    the tests pin; everything else is speculative and rots.
  - ❌ Don't add `process.env.*` access. This PRP has no runtime.
  - ❌ Don't add `z.string().url()` to evidence URIs (rejects `file://`).
  - ❌ Don't drop `.strict()` on `CaptureOptionsSchema` "for flexibility."
  - ❌ Don't widen `HarnessErrorCode` to `string`. The fixed enum is the
    failure-classification surface PRP-B's `errors.ts` maps to.
  - ❌ Don't inline `Alpha2` here as a re-declaration when a `primitives.ts`
    factor-out is cheap — UNLESS no third caller exists yet (Task 6).
  - ❌ Don't commit at red unless the message is explicitly `WIP — red`.

  ## Confidence: 9 / 10

  Greenfield contracts in a package that already follows the same shape
  for four other schemas. The one risk: D6 (URI scheme is
  `z.string().min(1)` not `z.string().url()`). If PRP-B picks a different
  scheme that wants URL validation, we adjust here — one-line change.
