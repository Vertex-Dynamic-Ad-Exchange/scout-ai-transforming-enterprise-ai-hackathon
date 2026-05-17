import { describe, expect, it } from "vitest";
import type {
  ConsumeOptions,
  NackReason,
  ProfileJob,
  ProfileQueue,
  QueueDelivery,
} from "@scout/shared";

describe("ProfileQueue interface — compile-time assignability", () => {
  it("satisfies a minimal literal impl with async-generator consume", () => {
    const impl = {
      async enqueue(_job: ProfileJob): Promise<void> {
        return;
      },
      consume(_opts: ConsumeOptions): AsyncIterableIterator<QueueDelivery> {
        async function* gen(): AsyncIterableIterator<QueueDelivery> {
          // empty generator — the type signature is what we are pinning.
        }
        return gen();
      },
    } satisfies ProfileQueue;
    expect(typeof impl.enqueue).toBe("function");
    expect(typeof impl.consume).toBe("function");
  });

  it("accepts a NackReason with kind 'transient' + retryAt", () => {
    const r: NackReason = {
      kind: "transient",
      detail: "timeout",
      retryAt: "2026-05-16T00:00:30.000Z",
    };
    expect(r.kind).toBe("transient");
  });

  it("accepts a NackReason with kind 'poison' (no retryAt)", () => {
    const r: NackReason = { kind: "poison", detail: "schema_invalid" };
    expect(r.kind).toBe("poison");
  });

  it("accepts a ConsumeOptions literal", () => {
    const controller = new AbortController();
    const opts: ConsumeOptions = {
      signal: controller.signal,
      visibilityTimeoutMs: 120_000,
    };
    expect(opts.visibilityTimeoutMs).toBe(120_000);
  });
});
