import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentVerdict,
  ConsumeOptions,
  ProfileJob,
  QueueDelivery,
  Verifier,
  VerifierContext,
} from "@scout/shared";
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
} from "./testRig.js";

// PRP-E Task 4 / D8: graceful shutdown polish. At-least-once invariant: a job
// that does NOT commit before grace expires nacks-transient
// (`detail: "shutdown"`), never silently acks.

const SHUTDOWN_KEYS = ["PROFILER_SHUTDOWN_GRACE_MS", "PROFILER_SHUTDOWN_HARD_KILL_MS"];

beforeEach(() => {
  for (const k of SHUTDOWN_KEYS) delete process.env[k];
});

afterEach(() => {
  vi.useRealTimers();
});

interface Controlled {
  verifier: Verifier;
  release: () => void;
  observed: () => AbortSignal | null;
}

function controlledImage(): Controlled {
  let observed: AbortSignal | null = null;
  let release: () => void = () => {};
  const verifier = fakeVerifier("image", (_c, ctx: VerifierContext) => {
    observed = ctx.abortSignal;
    return new Promise<AgentVerdict>((resolve) => {
      release = () => resolve(allowVerdict("image"));
    });
  });
  return { verifier, release: () => release(), observed: () => observed };
}

interface Rig {
  deps: ProfilerDeps;
  queue: ReturnType<typeof newQueue>;
  wrapped: ReturnType<typeof wrapQueueWithNackSpy>;
  profileStore: ReturnType<typeof fakeProfileStore>;
  harness: ReturnType<typeof fakeHarness>;
}

function buildRig(image?: Verifier): Rig {
  const harness = fakeHarness(async () => buildCapture());
  const profileStore = fakeProfileStore();
  const queue = newQueue();
  const wrapped = wrapQueueWithNackSpy(queue);
  const deps: ProfilerDeps = {
    harness,
    verifiers: {
      text: fakeVerifier("text", async () => allowVerdict("text")),
      image: image ?? fakeVerifier("image", async () => allowVerdict("image")),
      video: fakeVerifier("video", async () => allowVerdict("video")),
    },
    arbiter: fakeArbiter(async () => allowArbiter()),
    queue: wrapped.queue,
    profileStore,
    auditStore: fakeAuditStore(),
    logger: fakeLogger(),
  };
  return { deps, queue, wrapped, profileStore, harness };
}

async function waitUntil(p: () => boolean, budgetMs = 2000): Promise<void> {
  const t0 = Date.now();
  while (!p()) {
    if (Date.now() - t0 > budgetMs) throw new Error("waitUntil timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("runProfiler.shutdown — D8 grace branches", () => {
  it("settles within grace → ack fires, nack does NOT (happy)", async () => {
    process.env["PROFILER_SHUTDOWN_GRACE_MS"] = "1000";
    const c = controlledImage();
    const rig = buildRig(c.verifier);
    const handle = createProfiler(rig.deps);
    await rig.queue.enqueue(buildJob({ id: "j-natural" }));
    const startP = handle.start();
    await waitUntil(() => c.observed() !== null);
    const stopP = handle.stop();
    await new Promise((r) => setTimeout(r, 10));
    c.release();
    await stopP;
    await startP;
    expect(rig.profileStore.put).toHaveBeenCalledTimes(1);
    expect(rig.wrapped.nack).not.toHaveBeenCalled();
  });

  it("exceeds grace → nack-transient 'shutdown' fires, ack NEVER (at-least-once)", async () => {
    process.env["PROFILER_SHUTDOWN_GRACE_MS"] = "30";
    process.env["PROFILER_SHUTDOWN_HARD_KILL_MS"] = "500";
    const c = controlledImage();
    const rig = buildRig(c.verifier);
    const handle = createProfiler(rig.deps);
    await rig.queue.enqueue(buildJob({ id: "j-stuck" }));
    const startP = handle.start();
    await waitUntil(() => c.observed() !== null);
    const stopP = handle.stop();
    await new Promise((r) => setTimeout(r, 80));
    c.release(); // worker re-enters, observes gracePassed, nacks-transient
    await stopP;
    await startP;
    expect(rig.profileStore.put).not.toHaveBeenCalled();
    expect(rig.wrapped.nack).toHaveBeenCalledTimes(1);
    const reason = rig.wrapped.nack.mock.calls[0]![0];
    expect(reason.kind).toBe("transient");
    expect(reason.detail).toBe("shutdown");
  });
});

describe("runProfiler.shutdown — gotcha 258 abort propagation", () => {
  it("verifier ctx.abortSignal.aborted === true shortly after stop()", async () => {
    process.env["PROFILER_SHUTDOWN_GRACE_MS"] = "5000";
    const c = controlledImage();
    const rig = buildRig(c.verifier);
    const handle = createProfiler(rig.deps);
    await rig.queue.enqueue(buildJob({ id: "j-abort" }));
    const startP = handle.start();
    await waitUntil(() => c.observed() !== null);
    const stopP = handle.stop();
    await new Promise((r) => setTimeout(r, 20));
    expect(c.observed()!.aborted).toBe(true);
    c.release();
    await stopP;
    await startP;
  });
});

describe("runProfiler.shutdown — D9 LRU preserved across stop/start", () => {
  it("processed job is NOT re-captured on second start+enqueue", async () => {
    const rig = buildRig();
    const handle = createProfiler(rig.deps);
    await rig.queue.enqueue(buildJob({ id: "j-A" }));
    const s1 = handle.start();
    await waitUntil(() => rig.profileStore.put.mock.calls.length >= 1);
    await handle.stop();
    await s1;
    const captureCallsAfter1 = rig.harness.capturePage.mock.calls.length;
    expect(captureCallsAfter1).toBe(1);

    await rig.queue.enqueue(buildJob({ id: "j-A" }));
    const s2 = handle.start();
    await new Promise((r) => setTimeout(r, 40));
    await handle.stop();
    await s2;
    expect(rig.harness.capturePage.mock.calls.length).toBe(captureCallsAfter1);
    expect(rig.profileStore.put.mock.calls.length).toBe(1);
  });
});

describe("runProfiler.shutdown — double stop() idempotent", () => {
  it("second stop() resolves without throwing", async () => {
    const rig = buildRig();
    const handle = createProfiler(rig.deps);
    const startP = handle.start();
    await new Promise((r) => setTimeout(r, 5));
    const a = handle.stop();
    const b = handle.stop();
    await Promise.all([a, b]);
    await startP;
  });
});

describe("runProfiler.shutdown — at-least-once: ack count 0 on shutdown path", () => {
  it("only nack fires, never ack (regression guard for D8)", async () => {
    process.env["PROFILER_SHUTDOWN_GRACE_MS"] = "30";
    process.env["PROFILER_SHUTDOWN_HARD_KILL_MS"] = "500";
    const c = controlledImage();
    const rig = buildRig(c.verifier);
    const ackSpy = vi.fn();
    // Wrap the already-nack-spied queue to also observe ack.
    const inner = rig.deps.queue;
    rig.deps.queue = {
      enqueue: (job: ProfileJob) => inner.enqueue(job),
      consume(opts: ConsumeOptions) {
        const it = inner.consume(opts);
        const iter: AsyncIterableIterator<QueueDelivery> = {
          [Symbol.asyncIterator]() {
            return iter;
          },
          async next() {
            const r = await it.next();
            if (r.done) return r;
            return {
              done: false,
              value: {
                job: r.value.job,
                ack: async () => {
                  ackSpy();
                  await r.value.ack();
                },
                nack: r.value.nack,
              },
            };
          },
          async return(value) {
            if (it.return) return it.return(value);
            return { value, done: true };
          },
        };
        return iter;
      },
    };
    const handle = createProfiler(rig.deps);
    await rig.queue.enqueue(buildJob({ id: "j-no-ack" }));
    const startP = handle.start();
    await waitUntil(() => c.observed() !== null);
    const stopP = handle.stop();
    await new Promise((r) => setTimeout(r, 80));
    c.release();
    await stopP;
    await startP;
    expect(ackSpy).not.toHaveBeenCalled();
    expect(rig.wrapped.nack).toHaveBeenCalledTimes(1);
    expect(rig.wrapped.nack.mock.calls[0]![0].kind).toBe("transient");
    expect(rig.wrapped.nack.mock.calls[0]![0].detail).toBe("shutdown");
  });
});
