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
import { computeTtl } from "./ttlPolicy.js";

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
  elapsedMs: number;
}

// PRP-C D7: fixed order — text, image, video — then arbiter. Skip slots for
// kinds the loop never attempted (e.g., video dropped); include `null` for
// attempted-but-trace-missing slots (Task 14 makes the gap observable).
const KIND_ORDER: VerifierKind[] = ["text", "image", "video"];

/**
 * PRP-E D1/D2: tenant-scope an evidence URI emitted by the harness so that
 * `(advertiserId, contentHash)` collisions across advertisers map to disjoint
 * URIs (feature line 247 — regression here is a cross-tenant disclosure bug).
 *
 * Input shape from harness is `file:///tmp/scout-evidence/{contentHash}/{idx}.{ext}`
 * (or any URI whose last path segment is the desired filename). Output is
 * `evidence/{advertiserId}/{contentHash}/{filename}`. Pure string substitution;
 * extension preserved.
 *
 * Idempotent on same-advertiser already-namespaced input (D2). Throws on a
 * different-advertiser already-namespaced input — that's a cross-tenant
 * assignment bug, fail loud.
 */
export function rewriteEvidenceUri(uri: string, advertiserId: string, contentHash: string): string {
  if (advertiserId.length === 0) {
    throw new Error("evidence URI rewrite: advertiserId is required");
  }
  const selfPrefix = `evidence/${advertiserId}/`;
  if (uri.startsWith(selfPrefix)) return uri;
  if (uri.startsWith("evidence/")) {
    throw new Error("evidence URI namespace conflict");
  }
  const path = uri.split("?")[0]!.split("#")[0]!;
  const lastSlash = path.lastIndexOf("/");
  const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  if (filename.length === 0) {
    throw new Error("evidence URI rewrite: no filename in URI");
  }
  return `evidence/${advertiserId}/${contentHash}/${filename}`;
}

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
  const { job, capture, verdicts, arbiter, elapsedMs } = ctx;
  // PRP-E Task 2 (D1): tenant-scope every evidence URI on commit. The boundary
  // is pinned here so `PageProfileSchema.parse` below sees the rewritten URI;
  // any earlier site lets unrewritten URIs leak into the audit row + dashboard
  // tenant filter (PRP-E § Anti-patterns).
  const screenshots: EvidenceRef[] = capture.screenshots.map((s) => ({
    kind: "screenshot" as const,
    uri: rewriteEvidenceUri(s.uri, job.advertiserId, capture.contentHash),
  }));
  const videoFrames: EvidenceRef[] = capture.videoSamples.map((v) => ({
    kind: "video_frame" as const,
    uri: rewriteEvidenceUri(v.uri, job.advertiserId, capture.contentHash),
  }));
  const profile: PageProfile = {
    id: ulid(),
    url: capture.url,
    contentHash: capture.contentHash,
    categories: arbiter.consensusCategories,
    detectedEntities: arbiter.consensusEntities,
    evidenceRefs: [...screenshots, ...videoFrames],
    capturedAt: capture.capturedAt,
    ttl: computeTtl(capture),
  };
  PageProfileSchema.parse(profile); // defense-in-depth (Task 16 sweep).
  observeTraceGaps(deps.logger, verdicts, arbiter, job);
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

function observeTraceGaps(
  logger: Logger,
  verdicts: AgentVerdict[],
  arbiter: ArbiterDecision,
  job: ProfileJob,
): void {
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
  // PRP-E D4: arbiter null counts toward the same counter. The Veea audit
  // claim is the END-TO-END chain; a missing arbiter trace is just as
  // sponsor-tech-broken as a missing verifier trace.
  if (arbiter.lobstertrapTraceId === null) {
    logger.warn({
      event: "lobstertrap_trace_missing",
      verifier: "arbiter",
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
