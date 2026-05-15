# Architecture — Pre-Bid AI Ad Verification

> Working doc. Decisions get appended here as they're made; open questions stay flagged at the bottom until resolved. Reflect locked choices back into `CLAUDE.md § Stack`.

## North star

One sentence: **an advertiser's bid request is gated by a sub-second agentic verification that the destination page (and the creative) match the advertiser's brand-safety policy — before money moves.**

This is a policy gate sitting in the auction lifecycle, not a post-impression audit. If the gate cannot answer in time, the auction proceeds with the bid suppressed — fail-closed, never silently fail-open.

## The latency reality

The hard constraint is **sub-second end-to-end** (CLAUDE.md). That number alone determines the shape of the system. Two facts that must drive every choice:

1. **A full LLM round-trip to Gemini Flash is ~300–800ms** under good conditions, with tail risk past 1s. One Flash call fits the budget; two synchronous calls do not. Pro is off the hot path entirely.
2. **A `browser-use` agent loop is multi-second.** It's a browser harness driven by an LLM step-by-step (`sessions.create` → `run` → multiple navigate/click/screenshot turns). Even one full loop is 5–30s. It **cannot** run inside a bid response window.

⇒ The system **must** split into a **hot path** (synchronous, ≤1s, one LLM call max) and a **warm path** (asynchronous, seconds-to-minutes, agent loops allowed) — the hot path consumes pre-computed artifacts the warm path produced.

If we ever feel pressure to put a `browser-use` call on the hot path, that's the signal we got the split wrong.

## Two paths

### Hot path — the gate (≤1s, fail-closed)

Triggered per bid request. Pipeline:

```
bid request ─▶ Gate ─▶ Profile lookup (cache) ─▶ Policy match (rules) ─▶ [optional Flash check] ─▶ ALLOW / DENY
```

- **Profile lookup**: keyed by `(page_url, content_hash)`. Hit → continue. Miss → DENY this bid and enqueue a warm-path profile job; subsequent bids on that page get the cached answer.
- **Policy match**: pure-function rule evaluation against the cached profile (categories, detected entities, creative tags, advertiser's policy YAML). No I/O. Sub-millisecond.
- **Optional Flash check**: only when the policy match is *ambiguous* (e.g., page profile is borderline on a high-stakes category). One Gemini Flash call with a tight max-tokens cap. Budget ~400ms. Skipped on clear-cut cases.
- **Verdict**: structured `{decision, reasons[], profile_id, policy_version, latency_ms}`. Reasons must cite which profile signals and which policy rules drove the call — required for the governance dashboard and audits.

Cache miss is the failure mode that matters most. If most bids miss, we're not sub-second; we're DENY-spamming. Sizing assumption: a small number of high-volume pages dominate, so a modest cache (Redis or in-memory LRU at the edge) gets the hit-rate up fast. **Validate this assumption before demo day** — if it's wrong, the demo dies on stage.

### Warm path — the profiler (async, agent loops live here)

Triggered by cache miss, by a publisher pre-registering a page, or on a schedule for known inventory. Pipeline:

```
profile job ─▶ Browser harness (browser-use) ─▶ Asset extraction ─▶ Verifier agents ─▶ Cross-check ─▶ Profile commit
```

- **Browser harness**: `browser-use` headless session renders the page, captures DOM text, screenshots (above-fold + viewport scroll samples), and any embedded video poster frames / first-second sample. Output is a structured `PageCapture` blob, not raw HTML.
- **Verifier agents** — three independent agents, run in parallel:
  - `text-verifier` (Gemini Pro on the DOM-text + headline/meta): topic categorization, NSFW/adult/political/etc. classifiers per advertiser-defined taxonomy.
  - `image-verifier` (Gemini Pro vision on screenshots): same taxonomy, visual modality.
  - `video-verifier` (Gemini Pro vision on sampled frames): same taxonomy, video modality. Skipped when no video present.
- **Cross-check**: the three verdicts go to a fourth `arbiter` agent that flags disagreements. Disagreement above a threshold → `HUMAN_REVIEW` queue, not a silent average. This is what makes the system "independent verification" rather than three rubber-stamps.
- **Profile commit**: writes `PageProfile { url, content_hash, categories, confidences, evidence[], verified_at, ttl }` to the cache the hot path reads from.

Latency for the warm path is "fast enough that a popular page is profiled before its bid volume ramps" — minutes, not real-time. We are *not* optimizing it; we are optimizing the hot path that reads its output.

## Where each sponsor tech lives

### Gemini (Track 2 — Gemini Award)

- **Hot path**: Gemini **Flash** only, and only for ambiguous-case escalation. One call, tight token budget.
- **Warm path**: Gemini **Pro** for the verifier agents (text + vision). Latency doesn't matter here; quality does.
- Heavy use across both paths is the Gemini Award story — make sure the submission video shows both.

### Veea Lobster Trap (Track 1 — Veea Award)

Lobster Trap is a **DPI proxy in front of every LLM call**, OpenAI-API-compatible. Architectural placement:

```
[any agent] ──▶ [Lobster Trap proxy] ──▶ [Gemini / other LLM]
                       │
                       └─▶ audit log, policy enforcement, _lobstertrap metadata inspection
```

Every agent → LLM call routes through Lobster Trap. That gives us, *for free in the submission narrative*:

- Prompt-injection defense at the seam (a verifier agent can't be jailbroken into ALLOWing a page by content embedded in that page's DOM — DPI inspects the declared-vs-detected intent).
- Audit trail per verdict (required anyway for the governance dashboard).
- YAML policies for `ALLOW / DENY / LOG / HUMAN_REVIEW / QUARANTINE / RATE_LIMIT` — these map almost 1:1 to the gate's own verdict vocabulary; we should pick names that align so the dashboard is one story, not two.

**Important**: no agent talks to Gemini directly. The integration cost is small (point the Gemini SDK base URL at the local Lobster Trap), but it has to be enforced as a build-time rule, not "we'll add it later."

### browser-use

The website-scanning layer. Open questions about it deferred to *Open questions* below — answer those before scaffolding the harness module.

Confirmed traits (from `browser-use.com` + `docs.browser-use.com`):

- SDK: `pip install browser-use-sdk` / `npm install browser-use-sdk`. API key against `cloud.browser-use.com`, or self-hosted harness (open source).
- Two modes: **Agent mode** (`sessions.create` / `run` — LLM-driven loop) and **Browser mode** (`browsers.create` — lower-level page control). For the profiler we likely want Browser mode for deterministic extraction, falling back to Agent mode only for pages that defeat naive scraping (consent walls, infinite scroll, JS-rendered content the harness has to interact with).
- Stealth browsers + 195+ country residential proxies — useful because brand-safety verdicts must reflect what a *real user in the target geo* sees, not what a datacenter IP sees behind a paywall.
- License + concrete latency numbers were not visible on the marketing/docs pages. **Confirm before locking it in as a hard dependency** (MIT/Apache vs. SaaS-only changes how plug-and-play it is for the main product).

## Module boundaries (plug-and-play requirement)

The hackathon constraint is that components port back into the main product without rewrite (CLAUDE.md § Hard constraints). That means the seams below are non-negotiable — they're typed contracts, not "we'll figure out the boundary later."

```
┌─────────────────────────────────────────────────────────────────┐
│  gate/         hot-path service. one HTTP endpoint: POST /verify│
│                  in:  BidVerificationRequest                    │
│                  out: VerificationVerdict                       │
├─────────────────────────────────────────────────────────────────┤
│  profiler/     warm-path worker. consumes ProfileJob from queue │
│                  emits: PageProfile to profile-store            │
├─────────────────────────────────────────────────────────────────┤
│  agents/       text-verifier, image-verifier, video-verifier,   │
│                arbiter. Each is a pure function over a typed    │
│                input → typed Verdict. No I/O outside the LLM    │
│                client. No knowledge of the queue or the cache.  │
├─────────────────────────────────────────────────────────────────┤
│  harness/      browser-use wrapper. one function:               │
│                  capturePage(url, opts) → PageCapture           │
│                Hides whether we're in Agent or Browser mode.    │
├─────────────────────────────────────────────────────────────────┤
│  policy/       YAML policy loader + matcher.                    │
│                  match(profile, policy) → PolicyMatchResult     │
│                Pure. Versioned. The policy version is in the    │
│                verdict so audits can replay.                    │
├─────────────────────────────────────────────────────────────────┤
│  llm-client/   Gemini SDK wrapper. Base URL points at Lobster   │
│                Trap. ALL LLM traffic goes through here — no     │
│                module imports the Gemini SDK directly.          │
├─────────────────────────────────────────────────────────────────┤
│  store/        ProfileStore + PolicyStore + AuditStore behind   │
│                interfaces. Demo impls: Redis / SQLite / files.  │
│                Prod impls swap in without touching call sites.  │
├─────────────────────────────────────────────────────────────────┤
│  dashboard/    governance UI. read-only over AuditStore +       │
│                Lobster Trap's own audit log.                    │
└─────────────────────────────────────────────────────────────────┘
```

Every cross-module boundary is a zod-validated typed contract (carry forward from `dynamic-ad-exchange`). No module reaches across — `gate/` does not import `harness/`, ever. The only thing wiring them is the queue + the store.

## Data shapes (sketch — to harden in code, not here)

- `BidVerificationRequest { advertiserId, policyId, pageUrl, creativeRef, geo, ts }`
- `PageProfile { id, url, contentHash, categories: {label, confidence}[], detectedEntities[], evidenceRefs[], capturedAt, ttl }`
- `Policy { id, version, advertiserId, rules: PolicyRule[], escalation: {ambiguousAction, humanReviewThreshold} }`
- `VerificationVerdict { decision: "ALLOW"|"DENY"|"HUMAN_REVIEW", reasons: Reason[], profileId, policyVersion, latencyMs, lobstertrapTraceId }`

`lobstertrapTraceId` on every verdict links the gate's audit row to Lobster Trap's own audit log — that linkage is the Veea-Award demo moment.

## Failure modes worth designing for now

- **Profile miss on a hot page**: covered above — DENY + enqueue. Acceptable for a brand-new page; *not* acceptable if it happens for the same page twice. Add a metric.
- **LLM provider outage**: Lobster Trap's `RATE_LIMIT` / `QUARANTINE` actions should be wired into the gate's fail-closed path. We don't want a Gemini blip to ALLOW everything.
- **Page changes after profile**: TTL on `PageProfile`. Aggressive TTL on news/UGC sites, longer on static.
- **Prompt injection via page content**: the whole point of routing verifier-agent LLM calls through Lobster Trap. The DPI policy must inspect the page-content payload before it reaches Gemini.
- **Adversarial advertiser**: an advertiser can't see another advertiser's policies or verdicts. Tenant isolation in `policy/` and `store/` from day one — no shared global rules table.

## What we are explicitly NOT building (hackathon scope)

- Real RTB integration. Demo uses a mocked bidstream replaying recorded bids.
- Live publisher onboarding flow. Pages are pre-seeded.
- Billing, contracts, IAB taxonomy compliance certification. Cite as roadmap in the pitch; do not implement.
- Multi-region cache replication. Single-region demo.
- A second hackathon submission's *delta* lives in its own repo/fork (per memory: secondary is a fork, not a parallel build).

## Open questions — decide before code

1. **Repo layout**: monorepo (turbo/pnpm workspaces, mirror `dynamic-ad-exchange`) vs. polyrepo per module. Plug-and-play argues monorepo with strict package boundaries.
2. **Hot-path runtime**: Node/TS (consistent with main product) vs. Go (Lobster Trap is Go; potentially lower P99). The latency budget probably tolerates Node + Bun/Fastify, but confirm with a 100-req synthetic before locking.
3. **Queue / store choices**: Redis (queue + cache + ProfileStore) is the obvious one-binary answer for a hackathon. Postgres for AuditStore. Confirm before scaffolding.
4. **browser-use deployment**: cloud API (`cloud.browser-use.com`, fastest to integrate, has stealth/proxies) vs. self-hosted harness (no SaaS dependency, but we own the infra). Cloud for hackathon, self-host as the productionization story? Confirm the license on the open-source harness first.
5. **browser-use mode**: Browser mode (deterministic) as default with Agent-mode fallback (for sites that resist scraping), or Agent mode end-to-end (simpler code, higher latency, higher cost)?
6. **Verifier-agent fan-out**: three parallel agents + arbiter is the "independent verification" story for Track 1. Confirm we can afford the Gemini Pro spend on warm-path profiles; if not, drop video-verifier first, then collapse text+image into one multimodal call.
7. **Lobster Trap policy file location**: in-repo (versioned with code, demo-friendly) vs. external store (production-shape). Probably in-repo with a clear "this would be DB-backed in prod" comment.
8. **Dashboard surface**: bespoke UI vs. embedding Lobster Trap's own dashboard + a thin verdict view on top. The latter is cheaper and lets the demo show Veea's UI directly — likely a Track-1 win.

## Update protocol

Append decisions to the relevant section with a date stamp. Don't rewrite history; the doc is more useful as a record of how we got here than as a polished final spec. When a section's decision lands, also reflect it in `CLAUDE.md § Stack`.
