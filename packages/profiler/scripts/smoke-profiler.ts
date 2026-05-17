// Manual smoke for @scout/profiler. NOT part of the test sweep — lives
// outside __tests__/ so vitest ignores it. Run with:
//   GEMINI_API_KEY=... LOBSTERTRAP_PROXY_URL=... BROWSER_USE_API_KEY=... \
//     pnpm --filter @scout/profiler run smoke
//
// PRP-E Task 7 / D11: hardcoded URL in source so output is comparable across
// runs (mirrors smoke-capture.ts pattern). bbc.com/news is video-heavy →
// expected trace_count === 4 on a healthy non-degraded run with Cluster C
// verifiers wired through real Lobster Trap. URL verified 2026-05-16.
//
// D10: exit 0 ONLY on full happy path AND non-null trace IDs. Exit 1 on any
// thrown error OR `trace_count` mismatch. A null `lobstertrapTraceId` on a
// non-degraded run is a sponsor-tech wire breakage and MUST fail the script
// (the Veea Award demo claim depends on it).
//
// SECURITY (mirrors smoke-capture.ts:19-20): never logs the full PageCapture
// (`domText` is up to 256 KiB of arbitrary page content); never logs the audit
// row's `lobstertrapTraceIds` directly (sponsor opaque token) — only the
// non-null COUNT.
//
// NOTE (2026-05-16): Cluster C verifiers + real LlmClient have not landed.
// Until they do, this script uses PRP-A stub verifiers + stub arbiter which
// return `lobstertrapTraceId: null` — the script will exit 1 with
// `trace_count: 0`. That is the documented sponsor-tech-not-wired state;
// re-run after Cluster C lands.
import { createHarness } from "@scout/harness";
import { InMemoryProfileQueue } from "@scout/store";
import type {
  AgentVerdict,
  Arbiter,
  ArbiterContext,
  ArbiterDecision,
  AuditStore,
  PageCapture,
  PageProfile,
  ProfileJob,
  ProfileStore,
  Verifier,
  VerifierContext,
  VerifierKind,
} from "@scout/shared";
import { createProfiler } from "../src/index.js";

const SMOKE_URL = "https://www.bbc.com/news";
const ADVERTISER_ID = "smoke-advertiser";
const POLICY_ID = "smoke-policy";
const WAIT_BUDGET_MS = 60_000;

interface PhaseTimings {
  captureMs: number;
  fanoutMs: number;
  arbiterMs: number;
  commitMs: number;
}

interface AuditRow {
  jobId: string;
  profileId?: string;
  lobstertrapTraceIds?: (string | null)[];
  decisionPath?: string[];
  elapsedMs?: number;
}

function stubVerifier(kind: VerifierKind): Verifier {
  // PRP-A stub shape. Real Cluster C verifier will route the prompt through
  // LlmClient (Lobster Trap proxy) and populate `lobstertrapTraceId`.
  return {
    kind,
    async verify(_c: PageCapture, _ctx: VerifierContext): Promise<AgentVerdict> {
      return {
        verifier: kind,
        decision: "ALLOW",
        categories: [],
        detectedEntities: [],
        evidenceRefs: [],
        modelLatencyMs: 0,
        lobstertrapTraceId: null,
      };
    },
  };
}

function stubArbiter(): Arbiter {
  return {
    async combine(
      _v: AgentVerdict[],
      _c: PageCapture,
      _ctx: ArbiterContext,
    ): Promise<ArbiterDecision> {
      return {
        decision: "ALLOW",
        confidence: 1.0,
        consensusCategories: [],
        consensusEntities: [],
        disagreements: [],
        humanReviewRecommended: false,
        lobstertrapTraceId: null,
      };
    },
  };
}

class MemoryProfileStore implements ProfileStore {
  private rows: { advertiserId: string; profile: PageProfile }[] = [];
  async put(advertiserId: string, profile: PageProfile): Promise<void> {
    this.rows.push({ advertiserId, profile });
  }
  async get(advertiserId: string, contentHash: string): Promise<PageProfile | null> {
    return (
      this.rows.find(
        (r) => r.advertiserId === advertiserId && r.profile.contentHash === contentHash,
      )?.profile ?? null
    );
  }
  count(): number {
    return this.rows.length;
  }
  last(): PageProfile | null {
    return this.rows[this.rows.length - 1]?.profile ?? null;
  }
}

class MemoryAuditStore implements AuditStore {
  rows: unknown[] = [];
  async put(row: unknown): Promise<void> {
    this.rows.push(row);
  }
}

function silentLogger(): import("@scout/shared").Logger {
  // Smoke prints its own structured summary; underlying loop logs are noise.
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
}

async function main(): Promise<void> {
  const harness = createHarness();
  const queue = new InMemoryProfileQueue();
  const profileStore = new MemoryProfileStore();
  const auditStore = new MemoryAuditStore();

  // Phase timing via small instrumenting wrappers. Pure proxies — no behavior
  // changes; only measure wall-clock per phase.
  const timings: PhaseTimings = { captureMs: 0, fanoutMs: 0, arbiterMs: 0, commitMs: 0 };

  const timedHarness: typeof harness = {
    async capturePage(url, opts) {
      const t0 = Date.now();
      try {
        return await harness.capturePage(url, opts);
      } finally {
        timings.captureMs = Date.now() - t0;
      }
    },
  };

  let fanoutStart = 0;
  const wrapVerifier = (v: Verifier): Verifier => ({
    kind: v.kind,
    async verify(capture, ctx) {
      if (fanoutStart === 0) fanoutStart = Date.now();
      try {
        return await v.verify(capture, ctx);
      } finally {
        timings.fanoutMs = Math.max(timings.fanoutMs, Date.now() - fanoutStart);
      }
    },
  });

  const arbiterStub = stubArbiter();
  const timedArbiter: Arbiter = {
    async combine(v, c, ctx) {
      const t0 = Date.now();
      try {
        return await arbiterStub.combine(v, c, ctx);
      } finally {
        timings.arbiterMs = Date.now() - t0;
      }
    },
  };

  const timedProfileStore: ProfileStore = {
    async put(advertiserId, profile) {
      const t0 = Date.now();
      try {
        return await profileStore.put(advertiserId, profile);
      } finally {
        timings.commitMs = Date.now() - t0;
      }
    },
    get(advertiserId, contentHash) {
      return profileStore.get(advertiserId, contentHash);
    },
  };

  const handle = createProfiler({
    harness: timedHarness,
    verifiers: {
      text: wrapVerifier(stubVerifier("text")),
      image: wrapVerifier(stubVerifier("image")),
      video: wrapVerifier(stubVerifier("video")),
    },
    arbiter: timedArbiter,
    queue,
    profileStore: timedProfileStore,
    auditStore,
    logger: silentLogger(),
  });

  const job: ProfileJob = {
    id: `smoke-${Date.now()}`,
    pageUrl: SMOKE_URL,
    advertiserId: ADVERTISER_ID,
    policyId: POLICY_ID,
    geo: "US",
    enqueuedAt: new Date().toISOString(),
    attempt: 1,
    degradationHint: "none",
  };

  const totalStart = Date.now();
  await queue.enqueue(job);
  const startP = handle.start();

  const deadline = Date.now() + WAIT_BUDGET_MS;
  while (profileStore.count() === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const totalMs = Date.now() - totalStart;
  await handle.stop();
  await startP;

  if (profileStore.count() === 0) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({ event: "smoke_failed", reason: "no_commit_within_budget", totalMs }),
    );
    process.exit(1);
  }

  const profile = profileStore.last();
  if (profile === null) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ event: "smoke_failed", reason: "no_profile" }));
    process.exit(1);
  }

  // Find the committed audit row (skip DLQ kind rows).
  const auditRow = auditStore.rows.find((r) =>
    (r as { kind?: string; decisionPath?: string[] }).decisionPath?.includes("committed"),
  ) as AuditRow | undefined;
  if (auditRow === undefined) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ event: "smoke_failed", reason: "no_audit_row" }));
    process.exit(1);
  }

  const traceIds = auditRow.lobstertrapTraceIds ?? [];
  const traceCount = traceIds.filter((t) => t !== null).length;

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      event: "summary",
      profileId: profile.id,
      captureMs: timings.captureMs,
      fanoutMs: timings.fanoutMs,
      arbiterMs: timings.arbiterMs,
      commitMs: timings.commitMs,
      totalMs,
      trace_count: traceCount,
    }),
  );

  // D10: expected 4 non-null traces on bbc.com/news (video-bearing). 3 only
  // on documented no-video URLs (D11) — bbc.com/news is video-bearing, so 3
  // would itself be a smoke failure here.
  const expected = 4;
  if (traceCount !== expected) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        event: "smoke_failed",
        reason: "trace_count_mismatch",
        expected,
        actual: traceCount,
      }),
    );
    process.exit(1);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({ event: "smoke_failed", error: e instanceof Error ? e.message : String(e) }),
  );
  process.exit(1);
});
