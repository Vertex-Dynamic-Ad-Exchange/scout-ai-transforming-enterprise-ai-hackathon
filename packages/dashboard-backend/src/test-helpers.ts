import type {
  AuditRowProfileJobDlq,
  AuditRowVerdict,
  Decision,
  EvidenceRef,
  PageProfile,
} from "@scout/shared";

export function makeVerdictRow(
  overrides: Partial<AuditRowVerdict> = {},
): AuditRowVerdict {
  const base: AuditRowVerdict = {
    kind: "verdict",
    id: "row-A-1",
    advertiserId: "A",
    ts: "2026-05-15T12:00:00.000Z",
    request: {
      advertiserId: "A",
      policyId: "pol1",
      pageUrl: "https://example.com/a",
      creativeRef: "cr-1",
      geo: "US",
      ts: "2026-05-15T12:00:00.000Z",
    },
    verdict: {
      decision: "ALLOW",
      reasons: [],
      profileId: null,
      policyVersion: "v1",
      latencyMs: 12,
      lobstertrapTraceId: null,
    },
    profile: null,
    declaredIntent: null,
    detectedIntent: null,
  };
  const merged: AuditRowVerdict = { ...base, ...overrides };
  if (overrides.verdict !== undefined) {
    merged.verdict = { ...base.verdict, ...overrides.verdict };
  }
  if (overrides.request !== undefined) {
    merged.request = { ...base.request, ...overrides.request };
  }
  return merged;
}

export function verdictRowFor(
  advertiserId: string,
  id: string,
  ts: string,
  decision: Decision = "ALLOW",
  pageUrl = "https://example.com/a",
): AuditRowVerdict {
  return makeVerdictRow({
    id,
    advertiserId,
    ts,
    verdict: { decision } as AuditRowVerdict["verdict"],
    request: { advertiserId, pageUrl } as AuditRowVerdict["request"],
  });
}

export function dlqRowFor(
  advertiserId: string,
  id: string,
  ts: string,
  pageUrl = "https://example.com/dlq",
): AuditRowProfileJobDlq {
  return {
    kind: "profile_job_dlq",
    id,
    advertiserId,
    ts,
    jobId: `${id}-job`,
    pageUrl,
    attempts: 3,
    nackReason: "timeout",
  };
}

export function makeProfile(
  url: string,
  evidenceRefs: EvidenceRef[] = [],
): PageProfile {
  return {
    id: `profile-${url}`,
    url,
    contentHash: "hash-1",
    categories: [],
    detectedEntities: [],
    evidenceRefs,
    capturedAt: "2026-05-15T12:00:00.000Z",
    ttl: 3600,
  };
}
