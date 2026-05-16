// PRP-C extraction: `handleJob` + `failJob` split out so `runProfiler.ts` stays
// under the 200-line cap. PRP-D wires `chooseDegradation` (pre-dispatch),
// `classifyError` (nack-classification), the DLQ-before-poison-nack contract,
// and the `verifier_blackout` sentinel through this layer.

import {
  HarnessException,
  type Arbiter,
  type ArbiterDecision,
  type AuditStore,
  type Category,
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
import { chooseDegradation, costOf, recordSpend, type SpendWindow } from "./costTripwire.js";
import { classifyError, computeRetryAt } from "./retry.js";
import type { ShutdownState } from "./runProfiler.js";

// PRP-C D4: profiler does NOT load `Policy` (would cross gate's tenancy seam).
const HUMAN_REVIEW_THRESHOLD = 0.7;

// PRP-D D7: 2-of-3 verifiers failing means the page has too little signal for
// a permissive policy to ALLOW. The category is the signal; the matching deny
// rule in `permissive-baseline.json` is filed as a follow-up (D11) — without
// it, the sentinel is a no-op label.
const SENTINEL_BLACKOUT: Category = { label: "verifier_blackout", confidence: 1 };
const BLACKOUT_FAIL_THRESHOLD = 2;

export interface HandleJobDeps {
  harness: Harness;
  verifiers: { text: Verifier; image: Verifier; video: Verifier; combined?: Verifier };
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
  window: SpendWindow,
  tuple: Tuple,
  abortSignal: AbortSignal,
  shutdownState?: ShutdownState,
): Promise<void> {
  const { job, ack, nack } = tuple;
  const clock = deps.clock ?? Date.now;
  const t0 = clock();
  const shutdownDriven = abortSignal.aborted;

  // PRP-C D10: LRU keyed on `job.id` (NOT contentHash). Ack is safe even on the
  // shutdown path: an already-processed job has nothing to retry.
  if (seen.has(job.id)) {
    await ack();
    return;
  }

  // PRP-D Task 9 thread 1+2: window-driven degradation + missing-combined guard.
  // The window upgrades severity (PRP-D D3 floor); the job-hint never downgrades.
  const derivedHint = chooseDegradation(window, job.degradationHint, clock(), deps.logger);
  if (derivedHint === "collapse_text_image" && deps.verifiers.combined === undefined) {
    // Feature line 265: lazy fail-loud at job-time (not at createProfiler).
    // Structural misconfiguration — direct poison; no retry would resolve.
    await failJob(
      deps,
      job,
      nack,
      {
        detail: "combined_verifier_unavailable",
        decisionPath: ["combined_verifier_unavailable"],
        lobstertrapTraceIds: [],
        elapsedMs: clock() - t0,
      },
      { kind: "poison", detail: "combined_verifier_unavailable" },
    );
    return;
  }

  let capture: PageCapture;
  try {
    capture = await deps.harness.capturePage(job.pageUrl, { geo: job.geo });
  } catch (e) {
    if (!(e instanceof HarnessException)) throw e;
    const reason = classifyError(e, { attempt: job.attempt, shutdownDriven });
    await failJob(
      deps,
      job,
      nack,
      {
        detail: `capture_failed:${e.code}`,
        decisionPath: ["capture_failed"],
        lobstertrapTraceIds: [],
        elapsedMs: clock() - t0,
      },
      reason,
    );
    return;
  }
  if (shutdownState?.gracePassed) {
    await nack({ kind: "transient", detail: "shutdown" });
    return;
  }

  const verdicts = await fanout({ verifiers: deps.verifiers, logger: deps.logger }, capture, {
    advertiserId: job.advertiserId,
    policyId: job.policyId,
    abortSignal,
    verifierTimeoutMs: cfg.verifierTimeoutMs,
    degradationHint: derivedHint,
  });

  // PRP-D Task 9 thread 3: feed the trip-wire after every verifier round.
  // Sliding-window (D1) — costs accumulated here drive the NEXT job's hint.
  const now = clock();
  for (const v of verdicts) recordSpend(window, now, costOf(v));

  const real = verdicts.filter(
    (v) => v.lobstertrapTraceId !== null || v.decision !== "HUMAN_REVIEW",
  ).length;
  if (real === 0) {
    const reason = synthesizeReason(job.attempt, cfg, "all_verifiers_failed");
    await failJob(
      deps,
      job,
      nack,
      {
        detail: "all_verifiers_failed",
        decisionPath: ["captured", "fanout_failed"],
        lobstertrapTraceIds: [],
        elapsedMs: clock() - t0,
      },
      reason,
    );
    return;
  }

  if (shutdownState?.gracePassed) {
    await nack({ kind: "transient", detail: "shutdown" });
    return;
  }

  const arb = await deps.arbiter.combine(verdicts, capture, {
    advertiserId: job.advertiserId,
    policyId: job.policyId,
    humanReviewThreshold: HUMAN_REVIEW_THRESHOLD,
    abortSignal,
  });

  // PRP-D Task 10 (D7): when the arbiter recommends human review AND ≥2
  // verifiers failed, append `verifier_blackout` so a permissive advertiser's
  // `ambiguousAction: ALLOW` does not silently allow a no-signal page.
  // ADDITION (not replacement) preserves the real arbiter signal.
  const failedCount = verdicts.length - real;
  const effectiveArb: ArbiterDecision =
    arb.humanReviewRecommended && failedCount >= BLACKOUT_FAIL_THRESHOLD
      ? { ...arb, consensusCategories: [...arb.consensusCategories, SENTINEL_BLACKOUT] }
      : arb;

  if (shutdownState?.gracePassed) {
    await nack({ kind: "transient", detail: "shutdown" });
    return;
  }

  try {
    await commitProfile(
      { profileStore: deps.profileStore, auditStore: deps.auditStore, logger: deps.logger },
      { job, capture, verdicts, arbiter: effectiveArb, elapsedMs: clock() - t0 },
    );
  } catch (e) {
    const reason = classifyError(e, { attempt: job.attempt, shutdownDriven });
    await failJob(
      deps,
      job,
      nack,
      {
        detail: "profile_store_unavailable",
        decisionPath: ["captured", "fanout", "arbitrated", "commit_failed"],
        lobstertrapTraceIds: orderedTraceIds(verdicts, effectiveArb),
        elapsedMs: clock() - t0,
      },
      reason,
    );
    return;
  }
  // PRP-E Task 4 / D8: final at-least-once gate. If grace expired between
  // commit and ack, the queue keeps the lease and re-delivery is safe — the
  // LRU short-circuit catches a re-run (and ProfileStore.put is idempotent
  // by (advertiserId, contentHash) anyway). NEVER ack on the shutdown path.
  if (shutdownState?.gracePassed) {
    await nack({ kind: "transient", detail: "shutdown" });
    return;
  }
  // Order: commit → ack → LRU (PRP-C anti-pattern — never set LRU pre-ack).
  await ack();
  seen.set(job.id);
}

interface FailRow {
  detail: string;
  decisionPath: string[];
  lobstertrapTraceIds: (string | null)[];
  elapsedMs: number;
}

function synthesizeReason(attempt: number, cfg: ProfilerConfig, _detail: string): NackReason {
  // Used when there is no `err` to classify (e.g. all-verifiers-failed). Mirrors
  // the max-attempts gate in `classifyError` so synthesized failures still poison
  // when the retry budget runs out.
  if (attempt >= cfg.maxAttempts) {
    return { kind: "poison", detail: "max_attempts_exhausted" };
  }
  return { kind: "transient", detail: _detail, retryAt: computeRetryAt(attempt) };
}

async function failJob(
  deps: { auditStore: AuditStore; logger: Logger },
  job: ProfileJob,
  nack: (r: NackReason) => Promise<void>,
  row: FailRow,
  reason: NackReason,
): Promise<void> {
  // Stage audit — same shape as PRP-C (decisionPath-driven) so existing
  // dashboards stay green.
  await safeAudit(deps, {
    advertiserId: job.advertiserId,
    jobId: job.id,
    lobstertrapTraceIds: row.lobstertrapTraceIds,
    decisionPath: row.decisionPath,
    elapsedMs: row.elapsedMs,
  });
  // PRP-D D8: DLQ row strictly BEFORE the poison nack — otherwise a consumer
  // reclaim can pick up the nack before the audit row commits, and the DLQ
  // dashboard never sees it. Structured fields ONLY (PRP-D § Security): never
  // include `capture.domText` — feature line 248.
  if (reason.kind === "poison") {
    await safeAudit(deps, {
      kind: "profile_job_dlq",
      advertiserId: job.advertiserId,
      jobId: job.id,
      attempt: job.attempt,
      reason: reason.detail,
      // PRP-E D5: DLQ row terminal decisionPath. The preceding stage row
      // tells you WHERE the job failed; this row tells you WHERE IT WENT.
      decisionPath: ["dlq"],
    });
  }
  await nack(reason);
}
