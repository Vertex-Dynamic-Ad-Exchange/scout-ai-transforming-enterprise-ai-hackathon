import { describe, expect, it } from "vitest";
import { HarnessError, HarnessException } from "@scout/shared";
import { createProfiler, type ProfilerDeps } from "../runProfiler.js";
import {
  allowArbiter,
  allowVerdict,
  buildCapture,
  buildJob,
  fakeArbiter,
  fakeAuditStore,
  fakeHarness,
  fakeLogger,
  fakeProfileStore,
  fakeVerifier,
  newQueue,
  wrapQueueWithNackSpy,
  type FakeLogger,
} from "./testRig.js";

// PRP-E Task 2: cross-advertiser URI disjointness on commit; same logical
// capture committed for two advertisers MUST produce disjoint evidenceRefs.
// Regression here is a cross-tenant disclosure bug (feature line 247).

async function driveOnce(deps: ProfilerDeps, ready: () => boolean): Promise<void> {
  const abort = new AbortController();
  const handle = createProfiler({ ...deps, signal: abort.signal });
  const run = handle.start();
  const t0 = Date.now();
  while (!ready()) {
    if (Date.now() - t0 > 2000) throw new Error("driveOnce timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
  abort.abort();
  await run;
}

function buildRig(): {
  deps: ProfilerDeps;
  profileStore: ReturnType<typeof fakeProfileStore>;
  auditStore: ReturnType<typeof fakeAuditStore>;
  queue: ReturnType<typeof newQueue>;
  logger: FakeLogger;
} {
  const cap = buildCapture({
    contentHash: "c".repeat(64),
    screenshots: [
      {
        uri: "file:///tmp/scout-evidence/cccc/0.png",
        kind: "above_fold",
        scrollY: 0,
        viewport: { w: 1280, h: 720 },
        bytes: 100,
      },
    ],
    videoSamples: [
      {
        uri: "file:///tmp/scout-evidence/cccc/0v.png",
        kind: "poster",
        timestampMs: 0,
        bytes: 100,
      },
    ],
  });
  const harness = fakeHarness(async () => cap);
  const profileStore = fakeProfileStore();
  const auditStore = fakeAuditStore();
  const queue = newQueue();
  const logger = fakeLogger();
  const deps: ProfilerDeps = {
    harness,
    verifiers: {
      text: fakeVerifier("text", async () => allowVerdict("text")),
      image: fakeVerifier("image", async () => allowVerdict("image")),
      video: fakeVerifier("video", async () => allowVerdict("video")),
    },
    arbiter: fakeArbiter(async () => allowArbiter()),
    queue,
    profileStore,
    auditStore,
    logger,
  };
  return { deps, profileStore, auditStore, queue, logger };
}

describe("commit — URI rewrite integration (PRP-E Task 2)", () => {
  it("rewrites screenshot + video URIs under evidence/{advertiserId}/...", async () => {
    const rig = buildRig();
    await rig.queue.enqueue(buildJob({ id: "j-1", advertiserId: "adv-A" }));
    await driveOnce(rig.deps, () => rig.profileStore.put.mock.calls.length > 0);

    const [, profile] = rig.profileStore.put.mock.calls[0]!;
    const uris = profile.evidenceRefs.map((r) => r.uri);
    // Screenshot first, then video frames; both rewritten under adv-A.
    expect(uris[0]).toBe(`evidence/adv-A/${profile.contentHash}/0.png`);
    expect(uris[1]).toBe(`evidence/adv-A/${profile.contentHash}/0v.png`);
    for (const uri of uris) {
      expect(uri.startsWith("evidence/adv-A/")).toBe(true);
    }
  });

  it("cross-advertiser commits of the same capture yield disjoint evidenceRefs (feature line 247)", async () => {
    const rigA = buildRig();
    const rigB = buildRig();
    await rigA.queue.enqueue(buildJob({ id: "ja", advertiserId: "adv-A" }));
    await rigB.queue.enqueue(buildJob({ id: "jb", advertiserId: "adv-B" }));
    await driveOnce(rigA.deps, () => rigA.profileStore.put.mock.calls.length > 0);
    await driveOnce(rigB.deps, () => rigB.profileStore.put.mock.calls.length > 0);

    const a = rigA.profileStore.put.mock.calls[0]![1];
    const b = rigB.profileStore.put.mock.calls[0]![1];
    expect(a.contentHash).toBe(b.contentHash); // same logical capture
    for (const refA of a.evidenceRefs) {
      expect(refA.uri.startsWith("evidence/adv-A/")).toBe(true);
    }
    for (const refB of b.evidenceRefs) {
      expect(refB.uri.startsWith("evidence/adv-B/")).toBe(true);
    }
    // Disjointness: no overlap in URIs.
    const setA = new Set(a.evidenceRefs.map((r) => r.uri));
    for (const refB of b.evidenceRefs) {
      expect(setA.has(refB.uri)).toBe(false);
    }
  });
});

describe("commit — audit-row trace gaps (PRP-E Task 3, D4)", () => {
  function countMissingMetric(logger: FakeLogger): number {
    return logger
      .events("info")
      .filter((e) => e["event"] === "metric" && e["name"] === "lobstertrap_trace_missing_total")
      .reduce((acc, e) => acc + (typeof e["value"] === "number" ? e["value"] : 0), 0);
  }

  it("arbiter null trace → audit row last index is null + metric += 1", async () => {
    const rig = buildRig();
    // Swap arbiter to return null trace.
    rig.deps.arbiter = fakeArbiter(async () => allowArbiter(null));
    await rig.queue.enqueue(buildJob({ id: "ja", advertiserId: "adv-A" }));
    await driveOnce(rig.deps, () => rig.profileStore.put.mock.calls.length > 0);

    const audit = rig.auditStore.put.mock.calls[0]![0] as {
      lobstertrapTraceIds: (string | null)[];
    };
    expect(audit.lobstertrapTraceIds).toHaveLength(4);
    expect(audit.lobstertrapTraceIds[3]).toBeNull();
    expect(countMissingMetric(rig.logger)).toBe(1);
  });

  it("all-null verifier + arbiter traces → counter += 4 (D4)", async () => {
    const rig = buildRig();
    rig.deps.verifiers = {
      text: fakeVerifier("text", async () => allowVerdict("text", null)),
      image: fakeVerifier("image", async () => allowVerdict("image", null)),
      video: fakeVerifier("video", async () => allowVerdict("video", null)),
    };
    rig.deps.arbiter = fakeArbiter(async () => allowArbiter(null));
    await rig.queue.enqueue(buildJob({ id: "j-all-null", advertiserId: "adv-A" }));
    await driveOnce(rig.deps, () => rig.profileStore.put.mock.calls.length > 0);

    // Profile still commits (D4 — brand-safety per-bid is gate's job).
    expect(rig.profileStore.put).toHaveBeenCalledTimes(1);
    const audit = rig.auditStore.put.mock.calls[0]![0] as {
      lobstertrapTraceIds: (string | null)[];
    };
    expect(audit.lobstertrapTraceIds).toEqual([null, null, null, null]);
    expect(countMissingMetric(rig.logger)).toBe(4);
  });
});

// PRP-E Task 5 / D5 — decisionPath matrix. Documents which audit
// `decisionPath` each terminal outcome must emit. Existing PRP-C/D tests cover
// individual outcomes; this table is the consolidated drift detector.
type Outcome =
  | "happy_commit"
  | "all_verifiers_fail"
  | "capture_throws"
  | "profile_store_throws"
  | "poison_dlq";

const D5_MATRIX: { outcome: Outcome; expected: string[] }[] = [
  { outcome: "happy_commit", expected: ["captured", "fanout", "arbitrated", "committed"] },
  { outcome: "all_verifiers_fail", expected: ["captured", "fanout_failed"] },
  { outcome: "capture_throws", expected: ["capture_failed"] },
  {
    outcome: "profile_store_throws",
    expected: ["captured", "fanout", "arbitrated", "commit_failed"],
  },
  { outcome: "poison_dlq", expected: ["dlq"] },
];

function throwBlocked(): never {
  throw new HarnessException(HarnessError.BLOCKED, "x");
}
function throwTimeout(): never {
  throw new HarnessException(HarnessError.TIMEOUT, "t");
}
function throwGen(): never {
  throw new Error("verifier failure");
}

describe("commit — D5 decisionPath matrix", () => {
  it.each(D5_MATRIX)("$outcome → decisionPath = $expected", async ({ outcome, expected }) => {
    const rig = buildRig();
    // capture_throws: BLOCKED@1 → transient capture_failed row.
    // poison_dlq: TIMEOUT@5 → max_attempts_exhausted poison → staging + DLQ rows.
    if (outcome === "capture_throws") rig.deps.harness = fakeHarness(async () => throwBlocked());
    if (outcome === "poison_dlq") rig.deps.harness = fakeHarness(async () => throwTimeout());
    if (outcome === "all_verifiers_fail") {
      rig.deps.verifiers = {
        text: fakeVerifier("text", async () => throwGen()),
        image: fakeVerifier("image", async () => throwGen()),
        video: fakeVerifier("video", async () => throwGen()),
      };
    }
    if (outcome === "profile_store_throws") {
      rig.profileStore.put.mockRejectedValue(new Error("store down"));
    }

    const abort = new AbortController();
    if (outcome === "poison_dlq") {
      rig.auditStore.put.mockImplementation(async (row) => {
        if ((row as { kind?: string }).kind === "profile_job_dlq") abort.abort();
      });
    } else if (outcome !== "happy_commit") {
      rig.auditStore.put.mockImplementation(async () => abort.abort());
    }
    const wrapped = wrapQueueWithNackSpy(rig.deps.queue);
    rig.deps.queue = wrapped.queue;
    rig.deps.signal = abort.signal;

    const handle = createProfiler(rig.deps);
    const startP = handle.start();
    await rig.queue.enqueue(
      buildJob({ id: `job-${outcome}`, attempt: outcome === "poison_dlq" ? 5 : 1 }),
    );
    if (outcome === "happy_commit") {
      while (rig.profileStore.put.mock.calls.length === 0) {
        await new Promise((r) => setTimeout(r, 5));
      }
      abort.abort();
    }
    await startP;

    const rows = rig.auditStore.put.mock.calls.map((c) => c[0] as Record<string, unknown>);
    // poison: matrix's "dlq" lives on the terminal DLQ row, not the staging row.
    const row =
      outcome === "poison_dlq"
        ? rows.find((r) => r["kind"] === "profile_job_dlq")
        : rows.find((r) => r["kind"] !== "profile_job_dlq");
    expect(row).toBeDefined();
    expect(row!["decisionPath"]).toEqual(expected);
  });
});
