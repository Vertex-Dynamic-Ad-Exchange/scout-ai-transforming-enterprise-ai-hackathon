// PRP-C extraction: `handleJob` + `failJob` split out so `runProfiler.ts` stays
// under the 200-line cap (PRP-C CLAUDE.md rules + validation gates). Both
// helpers are internal to `@scout/profiler`; the public surface remains the
// `runProfiler` / `createProfiler` pair in `runProfiler.ts`.

import {
  HarnessException,
  type Arbiter,
  type AuditStore,
  type Harness,
  type Logger,
  type NackReason,
  type PageCapture,
  type ProfileJob,
  type ProfileStore,
  type Verifier,
} from "@scout/shared";
import type { ProfilerConfig } from "./config.js";
import type { Lru } from "./lru.js";
import { fanout } from "./fanout.js";
import { commitProfile, orderedTraceIds, safeAudit } from "./commit.js";

// PRP-C D4: profiler does NOT load `Policy` (would cross gate's tenancy seam).
const HUMAN_REVIEW_THRESHOLD = 0.7;

export interface HandleJobDeps {
  harness: Harness;
  verifiers: { text: Verifier; image: Verifier; video: Verifier };
  arbiter: Arbiter;
  profileStore: ProfileStore;
  auditStore: AuditStore;
  logger: Logger;
  clock?: () => number;
}

export interface Tuple {
  job: ProfileJob;
  ack: () => Promise<void>;
  nack: (reason: NackReason) => Promise<void>;
}

export async function handleJob(
  deps: HandleJobDeps,
  cfg: ProfilerConfig,
  seen: Lru<string>,
  tuple: Tuple,
  abortSignal: AbortSignal,
): Promise<void> {
  const { job, ack, nack } = tuple;
  const clock = deps.clock ?? Date.now;
  const t0 = clock();
  // PRP-C D10: LRU keyed on `job.id` (NOT contentHash). Same id → cheap ack;
  // different id with same content → re-run, cache refresh.
  if (seen.has(job.id)) {
    await ack();
    return;
  }
  let capture: PageCapture;
  try {
    capture = await deps.harness.capturePage(job.pageUrl, { geo: job.geo });
  } catch (e) {
    if (!(e instanceof HarnessException)) throw e;
    await failJob(deps, job, nack, {
      detail: `capture_failed:${e.code}`,
      decisionPath: ["capture_failed"],
      lobstertrapTraceIds: [],
      elapsedMs: clock() - t0,
    });
    return;
  }
  const verdicts = await fanout({ verifiers: deps.verifiers, logger: deps.logger }, capture, {
    advertiserId: job.advertiserId,
    policyId: job.policyId,
    abortSignal,
    verifierTimeoutMs: cfg.verifierTimeoutMs,
    degradationHint: job.degradationHint,
  });
  const real = verdicts.filter(
    (v) => v.lobstertrapTraceId !== null || v.decision !== "HUMAN_REVIEW",
  ).length;
  if (real === 0) {
    await failJob(deps, job, nack, {
      detail: "all_verifiers_failed",
      decisionPath: ["captured", "fanout_failed"],
      lobstertrapTraceIds: [],
      elapsedMs: clock() - t0,
    });
    return;
  }
  const arb = await deps.arbiter.combine(verdicts, capture, {
    advertiserId: job.advertiserId,
    policyId: job.policyId,
    humanReviewThreshold: HUMAN_REVIEW_THRESHOLD,
    abortSignal,
  });
  try {
    await commitProfile(
      { profileStore: deps.profileStore, auditStore: deps.auditStore, logger: deps.logger },
      {
        job,
        capture,
        verdicts,
        arbiter: arb,
        ttlDefaultSeconds: cfg.ttlDefaultSeconds,
        elapsedMs: clock() - t0,
      },
    );
  } catch {
    await failJob(deps, job, nack, {
      detail: "profile_store_unavailable",
      decisionPath: ["captured", "fanout", "arbitrated", "commit_failed"],
      lobstertrapTraceIds: orderedTraceIds(verdicts, arb),
      elapsedMs: clock() - t0,
    });
    return;
  }
  // Anti-pattern: LRU `seen.set` BEFORE `ack`. Order: commit → ack → LRU.
  await ack();
  seen.set(job.id);
}

interface FailRow {
  detail: string;
  decisionPath: string[];
  lobstertrapTraceIds: (string | null)[];
  elapsedMs: number;
}

// TODO(PRP-D): backoff + retryAt + attempt cap + poison routing per `detail`.
async function failJob(
  deps: { auditStore: AuditStore; logger: Logger },
  job: ProfileJob,
  nack: (r: NackReason) => Promise<void>,
  row: FailRow,
): Promise<void> {
  await safeAudit(deps, {
    advertiserId: job.advertiserId,
    jobId: job.id,
    lobstertrapTraceIds: row.lobstertrapTraceIds,
    decisionPath: row.decisionPath,
    elapsedMs: row.elapsedMs,
  });
  await nack({ kind: "transient", detail: row.detail });
}
