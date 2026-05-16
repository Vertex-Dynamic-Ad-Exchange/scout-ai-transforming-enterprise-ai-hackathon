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
  wrapQueueWithNackSpy,
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

describe("runProfiler — TTL heuristic wiring (PRP-D Task 8)", () => {
  it("og:news capture → ttl = 1800 (PRP-D D12 news-or-article path)", async () => {
    const cap = buildCapture({
      metadata: { title: null, description: null, ogType: "news", lang: "en" },
    });
    const rig = buildRig({ capture: cap });
    await rig.queue.enqueue(buildJob());
    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);
    const [, profile] = rig.profileStore.put.mock.calls[0]!;
    expect(profile.ttl).toBe(1_800);
  });

  it("og:null + non-UGC host → ttl = 21600 (default branch unchanged)", async () => {
    // Default buildCapture already has ogType: null and url: example.test/article.
    const rig = buildRig();
    await rig.queue.enqueue(buildJob());
    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);
    const [, profile] = rig.profileStore.put.mock.calls[0]!;
    expect(profile.ttl).toBe(21_600);
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

// PRP-D Task 9: trip-wire floor + missing-combined fail-loud + classifyError +
// DLQ-before-poison-nack (D8).
describe("runProfiler — PRP-D Task 9 wiring", () => {
  it("Task 9a: window empty + job.degradationHint='drop_video' → video.verify NOT called", async () => {
    const rig = buildRig();
    await rig.queue.enqueue(buildJob({ degradationHint: "drop_video" }));
    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);
    expect(rig.video.verify).not.toHaveBeenCalled();
    expect(rig.text.verify).toHaveBeenCalledTimes(1);
    expect(rig.image.verify).toHaveBeenCalledTimes(1);
  });

  it("Task 9b: collapse_text_image without verifiers.combined → poison + DLQ + nack-poison", async () => {
    const rig = buildRig();
    const wrapped = wrapQueueWithNackSpy(rig.queue);
    const abort = new AbortController();
    rig.auditStore.put.mockImplementation(async (row) => {
      // Abort on the DLQ row so the test exits cleanly.
      if ((row as { kind?: string }).kind === "profile_job_dlq") abort.abort();
    });
    const deps: ProfilerDeps = { ...rig.deps, queue: wrapped.queue, signal: abort.signal };
    const handle = createProfiler(deps);
    await rig.queue.enqueue(buildJob({ degradationHint: "collapse_text_image" }));
    await handle.start();

    // Pre-dispatch fail: NO harness.capturePage call.
    expect(rig.harness.capturePage).not.toHaveBeenCalled();
    // DLQ audit row present with expected fields.
    const dlqRow = rig.auditStore.put.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((r) => r["kind"] === "profile_job_dlq");
    expect(dlqRow).toBeDefined();
    expect(dlqRow!["reason"]).toBe("combined_verifier_unavailable");
    expect(dlqRow!["advertiserId"]).toBe("adv-1");
    expect(dlqRow!["jobId"]).toBe("job-1");
    // Nack-poison fired.
    expect(wrapped.nack).toHaveBeenCalledTimes(1);
    expect(wrapped.nack.mock.calls[0]![0].kind).toBe("poison");
    expect(wrapped.nack.mock.calls[0]![0].detail).toBe("combined_verifier_unavailable");
  });

  it("Task 9c: BLOCKED @attempt=1 → transient nack (one-retry allowance)", async () => {
    const rig = buildRig({
      harness: async () => {
        throw new Hex(HarnessError.BLOCKED, "consent");
      },
    });
    const wrapped = wrapQueueWithNackSpy(rig.queue);
    const abort = new AbortController();
    rig.auditStore.put.mockImplementationOnce(async () => {
      abort.abort();
    });
    const deps: ProfilerDeps = { ...rig.deps, queue: wrapped.queue, signal: abort.signal };
    const handle = createProfiler(deps);
    await rig.queue.enqueue(buildJob({ attempt: 1 }));
    await handle.start();

    expect(wrapped.nack).toHaveBeenCalledTimes(1);
    const reason = wrapped.nack.mock.calls[0]![0];
    expect(reason.kind).toBe("transient");
    expect(reason.detail).toBe("blocked");
    expect(reason.retryAt).toBeDefined();
    // No DLQ audit row.
    const dlq = rig.auditStore.put.mock.calls.find(
      (c) => (c[0] as { kind?: string }).kind === "profile_job_dlq",
    );
    expect(dlq).toBeUndefined();
  });

  it("Task 9d: BLOCKED @attempt=2 → poison; DLQ audit row called BEFORE nack-poison (D8)", async () => {
    const rig = buildRig({
      harness: async () => {
        throw new Hex(HarnessError.BLOCKED, "consent");
      },
    });
    const wrapped = wrapQueueWithNackSpy(rig.queue);
    const abort = new AbortController();
    rig.auditStore.put.mockImplementation(async (row) => {
      if ((row as { kind?: string }).kind === "profile_job_dlq") abort.abort();
    });
    const deps: ProfilerDeps = { ...rig.deps, queue: wrapped.queue, signal: abort.signal };
    const handle = createProfiler(deps);
    await rig.queue.enqueue(buildJob({ attempt: 2 }));
    await handle.start();

    // Nack reason poison.
    expect(wrapped.nack).toHaveBeenCalledTimes(1);
    const reason = wrapped.nack.mock.calls[0]![0];
    expect(reason.kind).toBe("poison");
    expect(reason.detail).toBe("blocked_after_retry");

    // D8 ordering: DLQ audit invocation < nack invocation.
    const dlqCallIdx = rig.auditStore.put.mock.calls.findIndex(
      (c) => (c[0] as { kind?: string }).kind === "profile_job_dlq",
    );
    expect(dlqCallIdx).toBeGreaterThanOrEqual(0);
    const dlqInvocationOrder = rig.auditStore.put.mock.invocationCallOrder[dlqCallIdx]!;
    const nackInvocationOrder = wrapped.nack.mock.invocationCallOrder[0]!;
    expect(dlqInvocationOrder).toBeLessThan(nackInvocationOrder);
  });
});

// PRP-D Task 10: sentinel `verifier_blackout` (D7). 2-of-3 verifiers fail +
// arbiter recommends human review → append the sentinel; do NOT replace
// existing categories.
describe("runProfiler — PRP-D Task 10 sentinel", () => {
  it("appends verifier_blackout when humanReviewRecommended && failedCount ≥ 2", async () => {
    const rig = buildRig({
      arbiter: () => ({
        decision: "HUMAN_REVIEW",
        confidence: 0.6,
        consensusCategories: [{ label: "real", confidence: 0.6 }],
        consensusEntities: [],
        disagreements: [],
        humanReviewRecommended: true,
        lobstertrapTraceId: "lt-arb-blackout",
      }),
    });
    // Force 2 verifiers to throw — the synth replacements have
    // `decision: "HUMAN_REVIEW"` and `lobstertrapTraceId: null`, which is the
    // `real === 0` signal exception path in handleJob: those count as failed.
    rig.text.verify.mockRejectedValue(new Error("text down"));
    rig.image.verify.mockRejectedValue(new Error("image down"));
    // video still succeeds → real === 1, failedCount === 2.

    await rig.queue.enqueue(buildJob());
    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);

    const profile = rig.profileStore.put.mock.calls[0]![1];
    const labels = profile.categories.map((c) => c.label);
    expect(labels).toContain("real");
    expect(labels).toContain("verifier_blackout");
    const blackout = profile.categories.find((c) => c.label === "verifier_blackout");
    expect(blackout?.confidence).toBe(1);
  });

  it("does NOT append verifier_blackout when only 1 verifier failed", async () => {
    const rig = buildRig({
      arbiter: () => ({
        decision: "HUMAN_REVIEW",
        confidence: 0.6,
        consensusCategories: [{ label: "real", confidence: 0.6 }],
        consensusEntities: [],
        disagreements: [],
        humanReviewRecommended: true,
        lobstertrapTraceId: "lt-arb-1",
      }),
    });
    rig.text.verify.mockRejectedValue(new Error("text down"));
    // image + video succeed → failedCount = 1.

    await rig.queue.enqueue(buildJob());
    await drive(rig, () => rig.profileStore.put.mock.calls.length > 0);

    const profile = rig.profileStore.put.mock.calls[0]![1];
    const labels = profile.categories.map((c) => c.label);
    expect(labels).not.toContain("verifier_blackout");
  });
});

// PRP-D Task 11: DLQ row content + security — no raw `capture.domText`.
describe("runProfiler — PRP-D Task 11 DLQ security", () => {
  it("attempt=5 + TIMEOUT → poison/max_attempts_exhausted; DLQ row has no domText", async () => {
    const rig = buildRig({
      harness: async () => {
        throw new Hex(HarnessError.TIMEOUT, "slow");
      },
    });
    const wrapped = wrapQueueWithNackSpy(rig.queue);
    const abort = new AbortController();
    rig.auditStore.put.mockImplementation(async (row) => {
      if ((row as { kind?: string }).kind === "profile_job_dlq") abort.abort();
    });
    const deps: ProfilerDeps = { ...rig.deps, queue: wrapped.queue, signal: abort.signal };
    const handle = createProfiler(deps);
    await rig.queue.enqueue(buildJob({ attempt: 5 }));
    await handle.start();

    const dlqRow = rig.auditStore.put.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((r) => r["kind"] === "profile_job_dlq");
    expect(dlqRow).toBeDefined();
    // Required fields (PRP-D Task 11).
    expect(dlqRow!["kind"]).toBe("profile_job_dlq");
    expect(dlqRow!["advertiserId"]).toBe("adv-1");
    expect(dlqRow!["jobId"]).toBe("job-1");
    expect(dlqRow!["attempt"]).toBe(5);
    expect(dlqRow!["reason"]).toBe("max_attempts_exhausted");
    // Security: NEVER includes `capture.domText` (feature line 248).
    expect(JSON.stringify(dlqRow)).not.toContain("headline + body text");
    expect(dlqRow).not.toHaveProperty("domText");
    expect(dlqRow).not.toHaveProperty("capture");
  });
});
