import { describe, it, expect } from "vitest";
import type { AuditRow, AuditRowVerdict } from "@scout/shared";
import { createStores } from "./index.js";

function makeVerdictRow(overrides: Partial<AuditRowVerdict> = {}): AuditRowVerdict {
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
  return { ...base, ...overrides };
}

describe("AuditStore — happy round-trip", () => {
  it("put → query → get returns the same row", async () => {
    const { auditStore } = createStores();
    const row: AuditRow = makeVerdictRow();
    await auditStore.put(row);

    const queryResult = await auditStore.query({ advertiserId: "A" });
    expect(queryResult.rows).toEqual([row]);
    expect(queryResult.nextCursor).toBeNull();

    const fetched = await auditStore.get("A", row.id);
    expect(fetched).toEqual(row);
  });
});
