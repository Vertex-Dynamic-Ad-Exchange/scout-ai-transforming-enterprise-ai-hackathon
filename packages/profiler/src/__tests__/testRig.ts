// Test rig for PRP-C profiler integration tests. Provides:
//   - hand-rolled fakes for Harness / Verifier / Arbiter / ProfileStore /
//     AuditStore / Logger (vi.fn-based so tests can spy + override per case);
//   - a builder for a valid PageCapture with N video samples;
//   - a builder for a valid ProfileJob;
//   - a `drive(deps)` helper that starts the profiler, waits for a condition,
//     aborts the queue, and awaits drain.
//
// The queue is the real PRP-B `InMemoryProfileQueue` — not a mock — so ack /
// nack / visibility-timeout reclaim are exercised end-to-end (PRP-C § TDD).

import { vi, type Mock } from "vitest";
import { InMemoryProfileQueue } from "@scout/store";
import {
  HarnessException,
  type AgentVerdict,
  type Arbiter,
  type ArbiterDecision,
  type AuditStore,
  type Harness,
  type Logger,
  type NackReason,
  type PageCapture,
  type PageProfile,
  type ProfileJob,
  type ProfileQueue,
  type ProfileStore,
  type QueueDelivery,
  type Verifier,
  type VerifierKind,
} from "@scout/shared";

export interface FakeHarness extends Harness {
  capturePage: Mock<Harness["capturePage"]>;
}

export function fakeHarness(impl: Harness["capturePage"]): FakeHarness {
  return { capturePage: vi.fn(impl) };
}

export interface FakeVerifier extends Verifier {
  verify: Mock<Verifier["verify"]>;
}

export function fakeVerifier(kind: VerifierKind, impl: Verifier["verify"]): FakeVerifier {
  return { kind, verify: vi.fn(impl) } as FakeVerifier;
}

export interface FakeArbiter extends Arbiter {
  combine: Mock<Arbiter["combine"]>;
}

export function fakeArbiter(impl: Arbiter["combine"]): FakeArbiter {
  return { combine: vi.fn(impl) };
}

export interface FakeProfileStore extends ProfileStore {
  put: Mock<ProfileStore["put"]>;
  get: Mock<ProfileStore["get"]>;
  rows(): { advertiserId: string; profile: PageProfile }[];
}

export function fakeProfileStore(): FakeProfileStore {
  const rows: { advertiserId: string; profile: PageProfile }[] = [];
  const put = vi.fn(async (advertiserId: string, profile: PageProfile) => {
    const existing = rows.findIndex(
      (r) => r.advertiserId === advertiserId && r.profile.contentHash === profile.contentHash,
    );
    if (existing >= 0) rows[existing] = { advertiserId, profile };
    else rows.push({ advertiserId, profile });
  });
  const get = vi.fn(async (advertiserId: string, contentHash: string) => {
    return (
      rows.find((r) => r.advertiserId === advertiserId && r.profile.contentHash === contentHash)
        ?.profile ?? null
    );
  });
  return { put, get, rows: () => rows.slice() };
}

export interface FakeAuditStore extends AuditStore {
  put: Mock<AuditStore["put"]>;
  rows(): unknown[];
}

export function fakeAuditStore(): FakeAuditStore {
  const rows: unknown[] = [];
  const put = vi.fn(async (row: unknown) => {
    rows.push(row);
  });
  return { put, rows: () => rows.slice() };
}

export interface FakeLogger extends Logger {
  info: Mock<Logger["info"]>;
  warn: Mock<Logger["warn"]>;
  error: Mock<Logger["error"]>;
  events(level: "info" | "warn" | "error"): Record<string, unknown>[];
}

export function fakeLogger(): FakeLogger {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return {
    info,
    warn,
    error,
    events: (level) =>
      ({ info, warn, error })[level].mock.calls.map((c) => c[0] as Record<string, unknown>),
  };
}

// PRP-B InMemoryProfileQueue with the canonical clock; smoke-tests assert
// against the queue's DLQ as well.
export function newQueue(): InMemoryProfileQueue {
  return new InMemoryProfileQueue();
}

/**
 * Wraps a ProfileQueue with a `nack` spy on every yielded delivery. PRP-D
 * Task 9 needs `mock.invocationCallOrder` between `auditStore.put` and the
 * per-delivery `nack`, which the underlying impl creates as a closure per
 * message (not a method on the queue object).
 */
export function wrapQueueWithNackSpy(q: ProfileQueue): {
  queue: ProfileQueue;
  nack: Mock<(reason: NackReason) => Promise<void>>;
} {
  const nack = vi.fn(async (_r: NackReason) => {});
  const wrapped: ProfileQueue = {
    enqueue: (job) => q.enqueue(job),
    consume(opts) {
      const inner = q.consume(opts);
      const iter: AsyncIterableIterator<QueueDelivery> = {
        [Symbol.asyncIterator]() {
          return iter;
        },
        async next() {
          const r = await inner.next();
          if (r.done) return r;
          const inner_tuple = r.value;
          const tuple: QueueDelivery = {
            job: inner_tuple.job,
            ack: () => inner_tuple.ack(),
            nack: async (reason) => {
              await nack(reason);
              await inner_tuple.nack(reason);
            },
          };
          return { value: tuple, done: false };
        },
        async return(value) {
          if (inner.return) return inner.return(value);
          return { value, done: true };
        },
      };
      return iter;
    },
  };
  return { queue: wrapped, nack };
}

const VALID_HASH = "a".repeat(64);

export function buildCapture(over: Partial<PageCapture> = {}): PageCapture {
  return {
    url: "https://example.test/article",
    requestedUrl: "https://example.test/article",
    contentHash: VALID_HASH,
    capturedAt: "2026-05-16T00:00:00.000Z",
    geo: "US",
    domText: "headline + body text",
    headline: "Example article",
    metadata: { title: "Example", description: null, ogType: null, lang: "en" },
    screenshots: [
      {
        uri: "https://cdn.test/shot1.png",
        kind: "above_fold",
        scrollY: 0,
        viewport: { w: 1280, h: 720 },
        bytes: 1024,
      },
    ],
    videoSamples: [
      {
        uri: "https://cdn.test/poster.png",
        kind: "poster",
        timestampMs: 0,
        bytes: 512,
      },
      {
        uri: "https://cdn.test/frame.png",
        kind: "first_second_frame",
        timestampMs: 1000,
        bytes: 512,
      },
    ],
    capturedBy: { mode: "browser", sdkVersion: "3.6.0", sessionId: "sess-1" },
    warnings: [],
    ...over,
  };
}

export function buildJob(over: Partial<ProfileJob> = {}): ProfileJob {
  return {
    id: "job-1",
    pageUrl: "https://example.test/article",
    advertiserId: "adv-1",
    policyId: "pol-1",
    geo: "US",
    enqueuedAt: "2026-05-16T00:00:00.000Z",
    attempt: 1,
    degradationHint: "none",
    ...over,
  };
}

export function allowVerdict(
  kind: VerifierKind,
  traceId: string | null = `lt-${kind}-1`,
): AgentVerdict {
  return {
    verifier: kind,
    decision: "ALLOW",
    categories: [],
    detectedEntities: [],
    evidenceRefs: [],
    modelLatencyMs: 5,
    lobstertrapTraceId: traceId,
  };
}

export function denyVerdict(kind: VerifierKind, traceId: string = `lt-${kind}-deny`): AgentVerdict {
  return {
    verifier: kind,
    decision: "DENY",
    categories: [{ label: "policy_violation", confidence: 1 }],
    detectedEntities: [],
    evidenceRefs: [],
    modelLatencyMs: 5,
    lobstertrapTraceId: traceId,
  };
}

export function allowArbiter(traceId: string | null = "lt-arb-1"): ArbiterDecision {
  return {
    decision: "ALLOW",
    confidence: 0.9,
    consensusCategories: [],
    consensusEntities: [],
    disagreements: [],
    humanReviewRecommended: false,
    lobstertrapTraceId: traceId,
  };
}

export function denyArbiter(traceId: string = "lt-arb-deny"): ArbiterDecision {
  return {
    decision: "DENY",
    confidence: 1,
    consensusCategories: [{ label: "policy_violation", confidence: 1 }],
    consensusEntities: [],
    disagreements: [],
    humanReviewRecommended: false,
    lobstertrapTraceId: traceId,
  };
}

export { HarnessException };
