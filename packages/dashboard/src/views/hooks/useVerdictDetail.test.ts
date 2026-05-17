import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type { AuditRow } from "@scout/shared";

vi.mock("../../api/client.js", () => ({
  getVerdict: vi.fn(),
  listVerdicts: vi.fn(),
  fetchVerdicts: vi.fn(),
  evidenceUrl: vi.fn(),
}));

import { getVerdict } from "../../api/client.js";
import { useVerdictDetail } from "./useVerdictDetail.js";

const getMock = vi.mocked(getVerdict);

function makeWrapper(qc: QueryClient): (props: { children: ReactNode }) => ReactNode {
  return ({ children }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

function verdictRow(id: string): AuditRow {
  return {
    kind: "verdict",
    id,
    advertiserId: "demo-advertiser",
    ts: "2026-05-17T12:00:00.000Z",
    request: {
      advertiserId: "demo-advertiser",
      policyId: "p1",
      pageUrl: "https://example.com/x",
      creativeRef: "c1",
      geo: "US",
      ts: "2026-05-17T12:00:00.000Z",
    },
    verdict: {
      decision: "ALLOW",
      reasons: [],
      profileId: "prof-1",
      policyVersion: "policy-v1",
      latencyMs: 47,
      lobstertrapTraceId: "lt-1",
    },
    profile: null,
    declaredIntent: null,
    detectedIntent: null,
  };
}

describe("useVerdictDetail", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    getMock.mockReset();
  });

  afterEach(() => {
    qc.clear();
  });

  it("id='v1' fires GET /api/verdicts/v1 and returns the row (happy)", async () => {
    const row = verdictRow("v1");
    getMock.mockResolvedValueOnce(row);

    const { result } = renderHook(() => useVerdictDetail("v1"), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(row);
    });
    expect(getMock).toHaveBeenCalledOnce();
    expect(getMock).toHaveBeenCalledWith("v1", expect.any(Object));
  });

  it("id===null disables the query — zero fetches (edge — no selection)", () => {
    renderHook(() => useVerdictDetail(null), {
      wrapper: makeWrapper(qc),
    });
    expect(getMock).not.toHaveBeenCalled();
  });

  it("backend 404 (getVerdict returns null) surfaces as isError===true (failure — cross-tenant or missing)", async () => {
    getMock.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useVerdictDetail("missing"), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
  });
});
