import { afterEach, describe, expect, it } from "vitest";
import { request } from "undici";
import { startInProcessGate, type InProcessGateHandle } from "../inProcessGate.js";

describe("startInProcessGate (Task 2 — happy path)", () => {
  let handle: InProcessGateHandle | undefined;

  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
  });

  it("boots a Fastify rig that returns 400 on empty body (handler.ts:41-44)", async () => {
    handle = await startInProcessGate();
    expect(handle.url.startsWith("http://127.0.0.1:")).toBe(true);
    const res = await request(`${handle.url}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
    await res.body.dump();
  });

  it("stop() resolves cleanly", async () => {
    handle = await startInProcessGate();
    await expect(handle.stop()).resolves.toBeUndefined();
    handle = undefined;
  });
});

describe("startInProcessGate (Task 3 — edge + failure)", () => {
  it("stop() called twice is idempotent (no throw on second call)", async () => {
    const h = await startInProcessGate();
    await h.stop();
    await expect(h.stop()).resolves.toBeUndefined();
  });

  it("two concurrent rigs bind to distinct ephemeral ports", async () => {
    const [a, b] = await Promise.all([startInProcessGate(), startInProcessGate()]);
    try {
      expect(a.url).not.toBe(b.url);
      expect(a.url.startsWith("http://127.0.0.1:")).toBe(true);
      expect(b.url.startsWith("http://127.0.0.1:")).toBe(true);
    } finally {
      await Promise.all([a.stop(), b.stop()]);
    }
  });
});
