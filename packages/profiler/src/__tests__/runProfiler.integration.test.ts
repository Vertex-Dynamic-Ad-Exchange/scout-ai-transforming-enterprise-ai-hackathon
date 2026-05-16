import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HarnessException as Hex,
  PageProfileSchema,
  type AgentVerdict,
  type ArbiterDecision,
  type PageCapture,
} from "@scout/shared";
import { HarnessError } from "@scout/shared";
import { createProfiler, type ProfilerDeps } from "../runProfiler.js";
import {
  allowArbiter,
  allowVerdict,
  buildCapture,
  buildJob,
  denyArbiter,
  denyVerdict,
  fakeArbiter,
  fakeAuditStore,
  fakeHarness,
  fakeLogger,
  fakeProfileStore,
  fakeVerifier,
  newQueue,
  type FakeArbiter,
  type FakeAuditStore,
  type FakeHarness,
  type FakeLogger,
  type FakeProfileStore,
  type FakeVerifier,
} from "./testRig.js";

const KEYS = [
  "PROFILER_CONCURRENCY",
  "PROFILER_VERIFIER_TIMEOUT_MS",
  "PROFILER_PROCESSED_LRU_SIZE",
  "PROFILER_TTL_DEFAULT_SECONDS",
  "PROFILER_VISIBILITY_TIMEOUT_MS",
  "PROFILER_SHUTDOWN_GRACE_MS",
];

interface Rig {
  deps: ProfilerDeps;
  queue: ReturnType<typeof newQueue>;
  harness: FakeHarness;
  text: FakeVerifier;
  image: FakeVerifier;
  video: FakeVerifier;
  arbiter: FakeArbiter;
  profileStore: FakeProfileStore;
  auditStore: FakeAuditStore;
  logger: FakeLogger;
}

interface RigOpts {
  capture?: PageCapture;
  textVerdict?: (capture: PageCapture) => AgentVerdict;
  imageVerdict?: (capture: PageCapture) => AgentVerdict;
  videoVerdict?: (capture: PageCapture) => AgentVerdict;
  arbiter?: (verdicts: AgentVerdict[]) => ArbiterDecision;
  harness?: (url: string) => Promise<PageCapture>;
}

function buildRig(opts: RigOpts = {}): Rig {
  const cap = opts.capture ?? buildCapture();
  const harness: FakeHarness = fakeHarness(opts.harness ?? (async () => cap));
  const text = fakeVerifier("text", async () =>
    (opts.textVerdict ?? (() => allowVerdict("text")))(cap),
  );
  const image = fakeVerifier("image", async () =>
    (opts.imageVerdict ?? (() => allowVerdict("image")))(cap),
  );
  const video = fakeVerifier("video", async () =>
    (opts.videoVerdict ?? (() => allowVerdict("video")))(cap),
  );
  const arbiter = fakeArbiter(async (verdicts) =>
    (opts.arbiter ?? (() => allowArbiter()))(verdicts),
  );
  const profileStore = fakeProfileStore();
  const auditStore = fakeAuditStore();
  const logger = fakeLogger();
  const queue = newQueue();
  const deps: ProfilerDeps = {
    harness,
    verifiers: { text, image, video },
    arbiter,
    queue,
    profileStore,
    auditStore,
    logger,
  };
  return { deps, queue, harness, text, image, video, arbiter, profileStore, auditStore, logger };
}

/** Wait until `predicate` returns true; polls microtasks + 5ms ticks. */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const t0 = Date.now();
  while (!predicate()) {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function drive<T extends Rig>(rig: T, ready: () => boolean): Promise<void> {
  const abort = new AbortController();
  const handle = createProfiler({ ...rig.deps, signal: abort.signal });
  const run = handle.start();
  await waitFor(ready);
  abort.abort();
  await run;
}

/**
 * Drive the loop until the FIRST `auditStore.put` call completes, then abort.
 *
 * Why: PRP-C D13 nacks-transient with no `retryAt`. PRP-B D5 turns absent
 * `retryAt` into immediate re-delivery. Composed, a permanent-failure job
 * (Tasks 10 / 11 / 12) busy-loops every microtask boundary until the test's
 * outer `abort.abort()` is observed — that's milliseconds in real time but
 * thousands of cycles, each appending to every `vi.fn()` call array. OOM in
 * ~5 min. Aborting from inside the audit mock breaks the cycle synchronously
 * on the first observed failure. The PRP-C nack-no-retryAt contract is
 * unchanged; PRP-D will replace with proper backoff + attempt cap + poison
 * routing (TODO already in handleJob.ts).
 */
async function driveUntilFirstAudit<T extends Rig>(rig: T): Promise<void> {
  const abort = new AbortController();
  rig.auditStore.put.mockImplementationOnce(async () => {
    abort.abort();
  });
  const handle = createProfiler({ ...rig.deps, signal: abort.signal });
  await handle.start();
}

beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("runProfiler — happy paths", () => {
  it("Task 3: 1 job, 3 verifiers happy, arbiter ALLOW → commit + 4-trace audit", async () => {
    const rig = buildRig();
    await rig.queue.enqueue(buildJob());

    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);

    // (a) profileStore.put × 1
    expect(rig.profileStore.put).toHaveBeenCalledTimes(1);
    const [, profile] = rig.profileStore.put.mock.calls[0]!;
    // (b) profile parses
    expect(() => PageProfileSchema.parse(profile)).not.toThrow();
    // (c) auditStore.put × 1 with 4 D7-ordered non-null trace IDs
    expect(rig.auditStore.put).toHaveBeenCalledTimes(1);
    const audit = rig.auditStore.put.mock.calls[0]![0] as {
      lobstertrapTraceIds: (string | null)[];
      decisionPath: string[];
    };
    expect(audit.lobstertrapTraceIds).toEqual([
      "lt-text-1",
      "lt-image-1",
      "lt-video-1",
      "lt-arb-1",
    ]);
    expect(audit.decisionPath).toEqual(["captured", "fanout", "arbitrated", "committed"]);
    // (e) harness called once with geo
    expect(rig.harness.capturePage).toHaveBeenCalledTimes(1);
    expect(rig.harness.capturePage.mock.calls[0]?.[1]).toEqual({ geo: "US" });
  });

  it("Task 5: same job.id re-delivered → LRU short-circuit, harness called once", async () => {
    const rig = buildRig();
    const abort = new AbortController();
    const handle = createProfiler({ ...rig.deps, signal: abort.signal });
    const run = handle.start();
    try {
      await rig.queue.enqueue(buildJob({ id: "job-A" }));
      await waitFor(() => rig.profileStore.put.mock.calls.length === 1);
      // Re-deliver the same id; the loop's seen-LRU short-circuits ack.
      await rig.queue.enqueue(buildJob({ id: "job-A" }));
      // Give the loop a few iterations to handle the duplicate.
      await new Promise((r) => setTimeout(r, 40));
      expect(rig.harness.capturePage).toHaveBeenCalledTimes(1);
      expect(rig.profileStore.put).toHaveBeenCalledTimes(1);
    } finally {
      abort.abort();
      await run;
    }
  });
});

describe("runProfiler — degradation + no-video", () => {
  it("Task 4: empty videoSamples → video.verify NOT invoked, audit has 3 trace IDs", async () => {
    const cap = buildCapture({ videoSamples: [] });
    const rig = buildRig({ capture: cap });
    await rig.queue.enqueue(buildJob());

    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);

    expect(rig.video.verify).not.toHaveBeenCalled();
    const audit = rig.auditStore.put.mock.calls[0]![0] as {
      lobstertrapTraceIds: (string | null)[];
    };
    expect(audit.lobstertrapTraceIds).toEqual(["lt-text-1", "lt-image-1", "lt-arb-1"]);
    expect(audit.lobstertrapTraceIds.length).toBe(3);
  });

  it("degradationHint=drop_video skips video.verify even when samples exist", async () => {
    const rig = buildRig();
    await rig.queue.enqueue(buildJob({ degradationHint: "drop_video" }));
    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);
    expect(rig.video.verify).not.toHaveBeenCalled();
  });
});

describe("runProfiler — collision + concurrency", () => {
  it("Task 6: (advertiserId, contentHash) collision overwrites — one row, latest capturedAt", async () => {
    const rig = buildRig({
      capture: buildCapture({
        capturedAt: "2026-05-15T00:00:00.000Z",
        contentHash: "b".repeat(64),
      }),
    });
    await rig.queue.enqueue(buildJob({ id: "job-1" }));
    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);

    // Now a different job.id but same (advertiserId, contentHash), fresher capturedAt.
    // Replace the harness fake to return the new capture.
    rig.harness.capturePage.mockImplementation(async () =>
      buildCapture({
        capturedAt: "2026-05-16T00:00:00.000Z",
        contentHash: "b".repeat(64),
      }),
    );
    await rig.queue.enqueue(buildJob({ id: "job-2" }));
    await drive(rig, () => rig.profileStore.put.mock.calls.length === 2);

    const rows = rig.profileStore.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.profile.capturedAt).toBe("2026-05-16T00:00:00.000Z");
  });

  it("Task 7: 10 jobs, PROFILER_CONCURRENCY=4 → max inflight ≤ 4, all commit", async () => {
    process.env["PROFILER_CONCURRENCY"] = "4";
    let inflight = 0;
    let max = 0;
    let counter = 0;
    const rig = buildRig({
      harness: async () => {
        inflight++;
        if (inflight > max) max = inflight;
        await new Promise<void>((r) => setTimeout(r, 5));
        inflight--;
        const hex = (counter++).toString(16).padStart(64, "0");
        return buildCapture({ contentHash: hex });
      },
    });
    for (let i = 0; i < 10; i++) {
      await rig.queue.enqueue(buildJob({ id: `j-${i}` }));
    }
    const abort = new AbortController();
    const handle = createProfiler({ ...rig.deps, signal: abort.signal });
    const run = handle.start();
    try {
      await waitFor(() => rig.profileStore.put.mock.calls.length === 10, 5_000);
    } finally {
      abort.abort();
      await run;
    }
    expect(max).toBeLessThanOrEqual(4);
    expect(rig.profileStore.put.mock.calls.length).toBe(10);
  });
});

describe("runProfiler — verifier failures", () => {
  it("Task 8: per-verifier timeout aborts the verifier, arbiter still sees 3, profile commits", async () => {
    // PRP-C calls for fake timers, but vitest 2.x's fake-timer interaction
    // with `AbortSignal.timeout` is unreliable; the assertion targets (a)-(e)
    // hold equivalently with a short real-time per-verifier timeout.
    process.env["PROFILER_VERIFIER_TIMEOUT_MS"] = "50";
    const rig = buildRig();
    let observedSignal: AbortSignal | null = null;
    rig.image.verify.mockImplementation(
      (_c, ctx) =>
        new Promise<AgentVerdict>((_resolve, reject) => {
          observedSignal = ctx.abortSignal;
          ctx.abortSignal.addEventListener("abort", () =>
            reject(new DOMException("timeout", "AbortError")),
          );
        }),
    );
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    try {
      await rig.queue.enqueue(buildJob());
      await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(observedSignal).not.toBeNull();
    expect(observedSignal!.aborted).toBe(true);
    const verdicts = rig.arbiter.combine.mock.calls[0]![0];
    expect(verdicts).toHaveLength(3);
    const synth = verdicts.find((v) => v.verifier === "image")!;
    expect(synth.decision).toBe("HUMAN_REVIEW");
    expect(synth.lobstertrapTraceId).toBeNull();
    expect(rig.profileStore.put).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("Task 9: image throws sync, text + video succeed → profile commits, ack fires", async () => {
    const rig = buildRig();
    rig.image.verify.mockImplementation(() => {
      throw new Error("sync boom");
    });
    await rig.queue.enqueue(buildJob());
    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);

    expect(rig.profileStore.put).toHaveBeenCalledTimes(1);
    // Arbiter saw 3 verdicts (2 real + 1 synth).
    const verdicts = rig.arbiter.combine.mock.calls[0]![0];
    expect(verdicts).toHaveLength(3);
    const synth = verdicts.find((v) => v.verifier === "image")!;
    expect(synth.decision).toBe("HUMAN_REVIEW");
    expect(synth.lobstertrapTraceId).toBeNull();
  });

  it("Task 10: all three verifiers reject → nack-transient, no commit, audit fanout_failed", async () => {
    const rig = buildRig();
    rig.text.verify.mockRejectedValue(new Error("text"));
    rig.image.verify.mockRejectedValue(new Error("image"));
    rig.video.verify.mockRejectedValue(new Error("video"));

    await rig.queue.enqueue(buildJob());
    await driveUntilFirstAudit(rig);

    expect(rig.profileStore.put).not.toHaveBeenCalled();
    const audit = rig.auditStore.put.mock.calls[0]![0] as {
      decisionPath: string[];
      lobstertrapTraceIds: (string | null)[];
    };
    expect(audit.decisionPath).toEqual(["captured", "fanout_failed"]);
    expect(audit.lobstertrapTraceIds).toEqual([]);
  });
});

describe("runProfiler — harness + commit failures", () => {
  it("Task 11: harness throws BLOCKED → nack-transient capture_failed:BLOCKED", async () => {
    const rig = buildRig({
      harness: async () => {
        throw new Hex(HarnessError.BLOCKED, "consent_wall");
      },
    });
    await rig.queue.enqueue(buildJob());
    await driveUntilFirstAudit(rig);

    expect(rig.profileStore.put).not.toHaveBeenCalled();
    const audit = rig.auditStore.put.mock.calls[0]![0] as { decisionPath: string[] };
    expect(audit.decisionPath).toEqual(["capture_failed"]);
  });

  it("Task 12: profileStore.put throws → nack profile_store_unavailable + audit commit_failed", async () => {
    const rig = buildRig();
    rig.profileStore.put.mockRejectedValue(new Error("redis down"));

    await rig.queue.enqueue(buildJob());
    await driveUntilFirstAudit(rig);

    const audit = rig.auditStore.put.mock.calls[0]![0] as {
      decisionPath: string[];
      lobstertrapTraceIds: (string | null)[];
    };
    expect(audit.decisionPath).toEqual(["captured", "fanout", "arbitrated", "commit_failed"]);
    // 4 trace IDs (verdicts + arbiter) — proves we serialized after fanout.
    expect(audit.lobstertrapTraceIds).toHaveLength(4);
  });

  it("Task 13: auditStore.put throws → log audit_dropped, profile still commits", async () => {
    const rig = buildRig();
    rig.auditStore.put.mockRejectedValueOnce(new Error("sqlite locked"));

    await rig.queue.enqueue(buildJob());
    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);

    expect(rig.profileStore.put).toHaveBeenCalledTimes(1);
    const dropped = rig.logger.events("warn").filter((e) => e["event"] === "audit_dropped");
    expect(dropped.length).toBeGreaterThan(0);
  });
});

describe("runProfiler — Lobster Trap observability + DENY propagation", () => {
  it("Task 14: text returns ALLOW with lobstertrapTraceId=null → warn + metric, profile commits", async () => {
    const rig = buildRig({ textVerdict: () => allowVerdict("text", null) });
    await rig.queue.enqueue(buildJob());
    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);

    expect(rig.profileStore.put).toHaveBeenCalledTimes(1);
    const audit = rig.auditStore.put.mock.calls[0]![0] as {
      lobstertrapTraceIds: (string | null)[];
    };
    expect(audit.lobstertrapTraceIds[0]).toBeNull();
    const warns = rig.logger.events("warn");
    const traceMissing = warns.find(
      (e) => e["event"] === "lobstertrap_trace_missing" && e["verifier"] === "text",
    );
    expect(traceMissing).toBeDefined();
    expect(traceMissing!["jobId"]).toBe("job-1");
    expect(traceMissing!["advertiserId"]).toBe("adv-1");
    const metric = rig.logger
      .events("info")
      .find((e) => e["event"] === "metric" && e["name"] === "lobstertrap_trace_missing_total");
    expect(metric).toBeDefined();
    expect(metric!["value"]).toBe(1);
  });

  it("Task 15: all 3 verifiers DENY + arbiter DENY → policy_violation propagates", async () => {
    const rig = buildRig({
      textVerdict: () => denyVerdict("text", "lt-text-deny"),
      imageVerdict: () => denyVerdict("image", "lt-image-deny"),
      videoVerdict: () => denyVerdict("video", "lt-video-deny"),
      arbiter: () => denyArbiter("lt-arb-deny"),
    });
    await rig.queue.enqueue(buildJob());
    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);

    const profile = rig.profileStore.put.mock.calls[0]![1];
    expect(profile.categories[0]?.label).toBe("policy_violation");
    const audit = rig.auditStore.put.mock.calls[0]![0] as {
      lobstertrapTraceIds: (string | null)[];
    };
    expect(audit.lobstertrapTraceIds).toEqual([
      "lt-text-deny",
      "lt-image-deny",
      "lt-video-deny",
      "lt-arb-deny",
    ]);
    expect(audit.lobstertrapTraceIds.every((id) => id !== null)).toBe(true);
  });
});

describe("runProfiler — schema-conformance sweep (Task 16 sweep)", () => {
  it("emitted PageProfile passes PageProfileSchema.parse independently", async () => {
    const rig = buildRig();
    await rig.queue.enqueue(buildJob());
    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);

    const [, profile] = rig.profileStore.put.mock.calls[0]!;
    expect(() => PageProfileSchema.parse(profile)).not.toThrow();
    // Profile evidenceRefs cover both screenshots and video frames in order.
    expect(profile.evidenceRefs[0]?.kind).toBe("screenshot");
    const videoRefs = profile.evidenceRefs.filter((r) => r.kind === "video_frame");
    expect(videoRefs.length).toBe(2);
  });
});
