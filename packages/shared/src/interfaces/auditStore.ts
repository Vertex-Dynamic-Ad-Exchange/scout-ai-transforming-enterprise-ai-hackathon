/**
 * Append-only audit trail. PRP-C D8: foundation has not landed an `AuditRow`
 * schema; PRP-E owns it. Until then `put` takes `unknown` and the profiler
 * writes structured rows of shape
 * `{ advertiserId, jobId, profileId?, lobstertrapTraceIds, decisionPath,
 *    elapsedMs }`. PRP-E swaps the param type to a real `AuditRowSchema`.
 *
 * Best-effort: failures are logged (`event: "audit_dropped"`) but do NOT
 * fail the surrounding job (feature line 131 + PRP-C Task 13).
 */
export interface AuditStore {
  put(row: unknown): Promise<void>;
}
