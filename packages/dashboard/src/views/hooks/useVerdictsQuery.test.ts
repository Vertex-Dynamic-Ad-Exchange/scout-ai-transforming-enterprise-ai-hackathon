import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

// Hoisted mock — every test in this file sees the same factory. `vi.mock`
// is hoisted above imports, so the import below resolves to the mock.
vi.mock("../../api/client.js", () => ({
  listVerdicts: vi.fn(async () => ({ rows: [], nextCursor: null })),
  fetchVerdicts: vi.fn(async () => ({
    status: 200,
    etag: null,
    body: { rows: [], nextCursor: null },
  })),
  getVerdict: vi.fn(),
  evidenceUrl: vi.fn(),
}));

import { fetchVerdicts } from "../../api/client.js";
import { useVerdictsQuery } from "./useVerdictsQuery.js";

const fetchMock = vi.mocked(fetchVerdicts);

// jsdom forbids assigning document.visibilityState directly; the
// property is read-only. Override via `defineProperty` and dispatch the
// matching event manually — that's what every real browser does, just
// without the redefine step.
function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function makeWrapper(qc: QueryClient): (props: { children: ReactNode }) => ReactNode {
  return ({ children }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe("useVerdictsQuery — polling + visibility (PRP 05 D3/D4/D5)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      status: 200,
      etag: null,
      body: { rows: [], nextCursor: null },
    });
    setVisibility("visible");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    qc.clear();
  });

  it("polls at 1000ms intervals while the tab is visible (happy)", async () => {
    renderHook(() => useVerdictsQuery({ kind: "verdict" }), {
      wrapper: makeWrapper(qc),
    });
    // Flush the initial mount + queryFn microtask.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("pauses polling while the tab is hidden — no further fetches across 1500ms (edge)", async () => {
    renderHook(() => useVerdictsQuery({ kind: "verdict" }), {
      wrapper: makeWrapper(qc),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => setVisibility("hidden"));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("debounces resume — five rapid visibility→visible toggles produce ONE fetch after 250ms (edge)", async () => {
    renderHook(() => useVerdictsQuery({ kind: "verdict" }), {
      wrapper: makeWrapper(qc),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();

    // Park the tab hidden first so refetchInterval can't fire during
    // the test window.
    act(() => setVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Five hidden→visible toggles within 100ms. The debounce timer
    // resets on every "visible" event.
    for (let i = 0; i < 5; i++) {
      act(() => setVisibility("hidden"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      act(() => setVisibility("visible"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    }

    // 200ms after the last toggle: still inside the debounce window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);

    // Cross the 250ms boundary — exactly one resume fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useVerdictsQuery — ETag / 304 (PRP 05 step 4)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    fetchMock.mockReset();
    setVisibility("visible");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    qc.clear();
  });

  it("first call sends If-None-Match=null; second call sends the captured etag and 304 preserves cached data (D11 + feature spec line 59)", async () => {
    const firstBody = { rows: [], nextCursor: null };
    fetchMock.mockResolvedValueOnce({
      status: 200,
      etag: '"abc"',
      body: firstBody,
    });
    fetchMock.mockResolvedValueOnce({
      status: 304,
      etag: '"abc"',
      body: null,
    });

    const { result } = renderHook(() => useVerdictsQuery({ kind: "verdict" }), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      { kind: "verdict" },
      null,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.current.data).toEqual(firstBody);

    // Trigger the next poll; the hook should pass the captured etag.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      { kind: "verdict" },
      '"abc"',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    // 304: cached payload is preserved, NOT replaced with null.
    expect(result.current.data).toEqual(firstBody);
  });
});

describe("useVerdictsQuery — failure path (PRP 05 step 5)", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    fetchMock.mockReset();
    setVisibility("visible");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    qc.clear();
  });

  it("after a 500 rejection, the next poll re-sends the previously-captured etag — error path must NOT advance etagRef", async () => {
    // First call succeeds and yields etag '"e1"'. Second call (the
    // 500) must not update etagRef — so the third call (retry) still
    // sends '"e1"'.
    fetchMock.mockResolvedValueOnce({
      status: 200,
      etag: '"e1"',
      body: { rows: [], nextCursor: null },
    });
    fetchMock.mockRejectedValueOnce(new Error("fetchVerdicts failed: HTTP 500"));
    fetchMock.mockResolvedValueOnce({
      status: 200,
      etag: '"e2"',
      body: { rows: [], nextCursor: null },
    });

    renderHook(() => useVerdictsQuery({ kind: "verdict" }), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // 1st poll — backend rejects.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // 2nd poll — backend succeeds. Etag header that was sent is the
    // one captured before the failure, NOT null and NOT the failed
    // call's null.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      { kind: "verdict" },
      '"e1"',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
