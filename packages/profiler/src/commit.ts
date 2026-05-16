import { ulid } from "ulid";
import {
  PageProfileSchema,
  type AgentVerdict,
  type ArbiterDecision,
  type AuditStore,
  type EvidenceRef,
  type Logger,
  type PageCapture,
  type PageProfile,
  type ProfileJob,
  type ProfileStore,
  type VerifierKind,
} from "@scout/shared";

export interface CommitDeps {
  profileStore: ProfileStore;
  auditStore: AuditStore;
  logger: Logger;
}

export interface CommitCtx {
  job: ProfileJob;
  capture: PageCapture;
  verdicts: AgentVerdict[];
  arbiter: ArbiterDecision;
  ttlDefaultSeconds: number;
  elapsedMs: number;
}

// PRP-C D7: fixed order — text, image, video — then arbiter. Skip slots for
// kinds the loop never attempted (e.g., video dropped); include `null` for
// attempted-but-trace-missing slots (Task 14 makes the gap observable).
const KIND_ORDER: VerifierKind[] = ["text", "image", "video"];

export function orderedTraceIds(
  verdicts: AgentVerdict[],
  arbiter: ArbiterDecision,
): (string | null)[] {
  const byKind = new Map<VerifierKind, AgentVerdict>();
  for (const v of verdicts) byKind.set(v.verifier, v);
  const ids: (string | null)[] = [];
  for (const kind of KIND_ORDER) {
    const v = byKind.get(kind);
    if (v !== undefined) ids.push(v.lobstertrapTraceId);
  }
  ids.push(arbiter.lobstertrapTraceId);
  return ids;
}

export async function commitProfile(deps: CommitDeps, ctx: CommitCtx): Promise<PageProfile> {
  const { job, capture, verdicts, arbiter, ttlDefaultSeconds, elapsedMs } = ctx;
  const screenshots: EvidenceRef[] = capture.screenshots.map((s) => ({
    // TODO(PRP-E): tenant-namespace URI rewrite per feature line 89.
    kind: "screenshot" as const,
    uri: s.uri,
  }));
  const videoFrames: EvidenceRef[] = capture.videoSamples.map((v) => ({
    // TODO(PRP-E): tenant-namespace URI rewrite per feature line 89.
    kind: "video_frame" as const,
    uri: v.uri,
  }));
  const profile: PageProfile = {
    id: ulid(),
    url: capture.url,
    contentHash: capture.contentHash,
    categories: arbiter.consensusCategories,
    detectedEntities: arbiter.consensusEntities,
    evidenceRefs: [...screenshots, ...videoFrames],
    capturedAt: capture.capturedAt,
    // TODO(PRP-D): TTL heuristic table (feature 93-97); flat default for now.
    ttl: ttlDefaultSeconds,
  };
  PageProfileSchema.parse(profile); // defense-in-depth (Task 16 sweep).
  observeTraceGaps(deps.logger, verdicts, job);
  const traceIds = orderedTraceIds(verdicts, arbiter);
  await deps.profileStore.put(job.advertiserId, profile); // may throw → handleJob catches.
  await safeAudit(deps, {
    advertiserId: job.advertiserId,
    jobId: job.id,
    profileId: profile.id,
    lobstertrapTraceIds: traceIds,
    decisionPath: ["captured", "fanout", "arbitrated", "committed"],
    elapsedMs,
  });
  return profile;
}

function observeTraceGaps(logger: Logger, verdicts: AgentVerdict[], job: ProfileJob): void {
  for (const v of verdicts) {
    if (v.lobstertrapTraceId !== null) continue;
    if (v.decision === "HUMAN_REVIEW") continue; // synth placeholder (D12) — already logged at fanout.
    // Task 14: non-degraded path with null trace ID is the worst sponsor-tech
    // failure mode; the warn + counter make it observable.
    logger.warn({
      event: "lobstertrap_trace_missing",
      verifier: v.verifier,
      jobId: job.id,
      advertiserId: job.advertiserId,
    });
    logger.info({ event: "metric", name: "lobstertrap_trace_missing_total", value: 1 });
  }
}

export async function safeAudit(
  deps: { auditStore: AuditStore; logger: Logger },
  row: unknown,
): Promise<void> {
  try {
    await deps.auditStore.put(row);
  } catch (e) {
    // Audit is best-effort (feature line 131 + Task 13). A future refactor
    // flipping default silently loses the audit trail; the colocated test
    // guards.
    deps.logger.warn({
      event: "audit_dropped",
      reason: e instanceof Error ? e.message : String(e),
    });
  }
}
