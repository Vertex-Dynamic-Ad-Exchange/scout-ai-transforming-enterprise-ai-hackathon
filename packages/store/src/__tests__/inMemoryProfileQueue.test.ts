import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NackReason, ProfileJob, QueueDelivery } from "@scout/shared";

import { InMemoryProfileQueue } from "../inMemoryProfileQueue.js";

const baseJob = (id: string, attempt = 1): ProfileJob => ({
  id,
  pageUrl: "https://example.test/article",
  advertiserId: "adv_1",
  policyId: "pol_1",
  geo: "US",
  enqueuedAt: "2026-05-16T00:00:00.000Z",
  attempt,
  degradationHint: "none",
});

async function takeOne(iter: AsyncIterator<QueueDelivery>): Promise<QueueDelivery> {
  const r = await iter.next();
  if (r.done) throw new Error("iterator done unexpectedly");
  return r.value;
}

describe("InMemoryProfileQueue — Task 1: constructor smoke", () => {
  it("constructs with no opts and is an instance of itself", () => {
    expect(new InMemoryProfileQueue()).toBeInstanceOf(InMemoryProfileQueue);
  });
});

describe("InMemoryProfileQueue — Task 2: happy enqueue/consume/ack", () => {
  it("yields the enqueued job; ack settles; iterator returns done on abort", async () => {
    const queue = new InMemoryProfileQueue();
    await queue.enqueue(baseJob("j_a"));
    const controller = new AbortController();
    const iter = queue.consume({ signal: controller.signal, visibilityTimeoutMs: 60_000 });

    const t1 = await takeOne(iter);
    expect(t1.job.id).toBe("j_a");
    expect(t1.job.attempt).toBe(1);
    await t1.ack();

    controller.abort();
    const r2 = await iter.next();
    expect(r2.done).toBe(true);
  });
});

describe("InMemoryProfileQueue — Task 3: FIFO order", () => {
  it("yields jobs in enqueue order", async () => {
    const queue = new InMemoryProfileQueue();
    await queue.enqueue(baseJob("j_1"));
    await queue.enqueue(baseJob("j_2"));
    await queue.enqueue(baseJob("j_3"));

    const controller = new AbortController();
    const iter = queue.consume({ signal: controller.signal, visibilityTimeoutMs: 60_000 });
    const t1 = await takeOne(iter);
    await t1.ack();
    const t2 = await takeOne(iter);
    await t2.ack();
    const t3 = await takeOne(iter);
    await t3.ack();
    controller.abort();

    expect([t1.job.id, t2.job.id, t3.job.id]).toEqual(["j_1", "j_2", "j_3"]);
  });
});

describe("InMemoryProfileQueue — Task 4: nack(transient) re-delivers with attempt+1", () => {
  it("delivers the same job.id again with incremented attempt", async () => {
    const queue = new InMemoryProfileQueue();
    await queue.enqueue(baseJob("j_t"));

    const controller = new AbortController();
    const iter = queue.consume({ signal: controller.signal, visibilityTimeoutMs: 60_000 });
    const t1 = await takeOne(iter);
    expect(t1.job.attempt).toBe(1);
    await t1.nack({ kind: "transient", detail: "boom" });

    const t2 = await takeOne(iter);
    expect(t2.job.id).toBe("j_t");
    expect(t2.job.attempt).toBe(2);
    await t2.ack();
    controller.abort();
  });
});

describe("InMemoryProfileQueue — Task 5: nack(poison) routes to DLQ", () => {
  it("places poison-nacked job in DLQ; iterator becomes empty", async () => {
    const queue = new InMemoryProfileQueue();
    await queue.enqueue(baseJob("j_p"));

    const controller = new AbortController();
    const iter = queue.consume({ signal: controller.signal, visibilityTimeoutMs: 60_000 });
    const t1 = await takeOne(iter);
    await t1.nack({ kind: "poison", detail: "malformed" });

    const dlq = queue.getDLQ();
    expect(dlq).toHaveLength(1);
    expect(dlq[0]?.id).toBe("j_p");

    controller.abort();
    const r2 = await iter.next();
    expect(r2.done).toBe(true);
  });

  it("getDLQ returns a defensive copy — caller mutation does not leak", async () => {
    const queue = new InMemoryProfileQueue();
    await queue.enqueue(baseJob("j_p2"));
    const controller = new AbortController();
    const iter = queue.consume({ signal: controller.signal, visibilityTimeoutMs: 60_000 });
    const t1 = await takeOne(iter);
    await t1.nack({ kind: "poison", detail: "x" });

    const snap = queue.getDLQ() as ProfileJob[];
    snap.length = 0;
    expect(queue.getDLQ()).toHaveLength(1);
    controller.abort();
  });
});

describe("InMemoryProfileQueue — Task 6: visibility-timeout reclaim", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("redelivers an unacked job with attempt+1 after visibilityTimeoutMs elapses", async () => {
    vi.setSystemTime(new Date("2026-05-16T00:00:00.000Z"));
    const queue = new InMemoryProfileQueue();
    await queue.enqueue(baseJob("j_r"));

    const controller = new AbortController();
    const iter = queue.consume({ signal: controller.signal, visibilityTimeoutMs: 100 });
    const t1 = await takeOne(iter);
    expect(t1.job.attempt).toBe(1);

    vi.advanceTimersByTime(101);
    const t2 = await takeOne(iter);
    expect(t2.job.id).toBe("j_r");
    expect(t2.job.attempt).toBe(2);
    await t2.ack();
    controller.abort();
  });
});

describe("InMemoryProfileQueue — Task 7: abort yields done; queue survives for fresh consume", () => {
  it("abort during empty-wait resolves { done: true }; second consume still drains", async () => {
    const queue = new InMemoryProfileQueue();
    const c1 = new AbortController();
    const iter1 = queue.consume({ signal: c1.signal, visibilityTimeoutMs: 60_000 });
    const next1 = iter1.next();
    c1.abort();
    const r1 = await next1;
    expect(r1.done).toBe(true);
    expect(r1.value).toBeUndefined();

    const c2 = new AbortController();
    const iter2 = queue.consume({ signal: c2.signal, visibilityTimeoutMs: 60_000 });
    await queue.enqueue(baseJob("j_after_abort"));
    const t = await takeOne(iter2);
    expect(t.job.id).toBe("j_after_abort");
    await t.ack();
    c2.abort();
  });
});

describe("InMemoryProfileQueue — Task 8: ack after nack throws (D2)", () => {
  it("throws on ack after nack(transient)", async () => {
    const queue = new InMemoryProfileQueue();
    await queue.enqueue(baseJob("j_an"));
    const c = new AbortController();
    const iter = queue.consume({ signal: c.signal, visibilityTimeoutMs: 60_000 });
    const t1 = await takeOne(iter);
    await t1.nack({ kind: "transient", detail: "x" });
    await expect(t1.ack()).rejects.toThrow(/ack after nack/);
    c.abort();
  });
});

describe("InMemoryProfileQueue — Task 9: double ack throws (D3)", () => {
  it("throws on second ack of the same tuple", async () => {
    const queue = new InMemoryProfileQueue();
    await queue.enqueue(baseJob("j_dd"));
    const c = new AbortController();
    const iter = queue.consume({ signal: c.signal, visibilityTimeoutMs: 60_000 });
    const t1 = await takeOne(iter);
    await t1.ack();
    await expect(t1.ack()).rejects.toThrow(/double ack/);
    c.abort();
  });
});

describe("InMemoryProfileQueue — Task 10: past retryAt re-delivers immediately (D5)", () => {
  it("scheduled-not-blocking — past retryAt drains on next iteration", async () => {
    const queue = new InMemoryProfileQueue();
    await queue.enqueue(baseJob("j_past"));
    const c = new AbortController();
    const iter = queue.consume({ signal: c.signal, visibilityTimeoutMs: 60_000 });

    const t1 = await takeOne(iter);
    const past: NackReason = {
      kind: "transient",
      detail: "x",
      retryAt: new Date(0).toISOString(),
    };
    await t1.nack(past);

    const t2 = await takeOne(iter);
    expect(t2.job.id).toBe("j_past");
    expect(t2.job.attempt).toBe(2);
    await t2.ack();
    c.abort();
  });
});

describe("InMemoryProfileQueue — Task 11: orphaned tuple after reclaim throws (D4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stale tuple's ack throws tuple-expired after reclaim re-delivers", async () => {
    vi.setSystemTime(new Date("2026-05-16T00:00:00.000Z"));
    const queue = new InMemoryProfileQueue();
    await queue.enqueue(baseJob("j_orph"));
    const c = new AbortController();
    const iter = queue.consume({ signal: c.signal, visibilityTimeoutMs: 100 });

    const t1 = await takeOne(iter);
    vi.advanceTimersByTime(101);
    const t2 = await takeOne(iter);
    expect(t2.job.attempt).toBe(2);

    await expect(t1.ack()).rejects.toThrow(/tuple expired/);
    await t2.ack();
    c.abort();
  });
});
