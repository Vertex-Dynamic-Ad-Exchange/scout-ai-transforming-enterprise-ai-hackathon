import { describe, it, expect } from "vitest";
import type {
  Arbiter,
  AuditStore,
  Harness,
  Logger,
  ProfileQueue,
  ProfileStore,
  Verifier,
} from "@scout/shared";
import { createProfiler } from "../runProfiler.js";
import type { ProfilerDeps, ProfilerHandle } from "../runProfiler.js";

// Hand-built minimal `satisfies ProfilerDeps` (PRP-C Task 2). The `as` shells
// stand in for impls — typechecking is what we are pinning here, not behavior.
const harness = {} as Harness;
const verifier = {} as Verifier;
const arbiter = {} as Arbiter;
const queue = {} as ProfileQueue;
const profileStore = {} as ProfileStore;
const auditStore = {} as AuditStore;
const logger = {} as Logger;

describe("ProfilerDeps", () => {
  it("a full dep set satisfies the interface", () => {
    const deps = {
      harness,
      verifiers: { text: verifier, image: verifier, video: verifier },
      arbiter,
      queue,
      profileStore,
      auditStore,
      logger,
    } satisfies ProfilerDeps;
    expect(deps.harness).toBeDefined();
  });

  it("compiles with optional verifiers.combined + clock + signal", () => {
    const deps = {
      harness,
      verifiers: { text: verifier, image: verifier, video: verifier, combined: verifier },
      arbiter,
      queue,
      profileStore,
      auditStore,
      logger,
      clock: () => 0,
      signal: new AbortController().signal,
    } satisfies ProfilerDeps;
    expect(deps.verifiers.combined).toBeDefined();
  });

  it("rejects a deps object missing `arbiter` at compile time", () => {
    const deps = {
      harness,
      verifiers: { text: verifier, image: verifier, video: verifier },
      // arbiter intentionally omitted to pin the missing-field error
      queue,
      profileStore,
      auditStore,
      logger,
      // @ts-expect-error — `arbiter` is required (PRP-C D1)
    } satisfies ProfilerDeps;
    expect(deps).toBeDefined();
  });
});

describe("createProfiler stub", () => {
  it("returns a ProfilerHandle with start/stop", () => {
    const handle: ProfilerHandle = createProfiler({
      harness,
      verifiers: { text: verifier, image: verifier, video: verifier },
      arbiter,
      queue,
      profileStore,
      auditStore,
      logger,
    });
    expect(typeof handle.start).toBe("function");
    expect(typeof handle.stop).toBe("function");
  });
});
