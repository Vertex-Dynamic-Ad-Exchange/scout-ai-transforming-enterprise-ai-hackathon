import { useEffect, useMemo, useRef } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  fetchVerdicts,
  type ListVerdictsParams,
  type ListVerdictsResult,
} from "../../api/client.js";

/**
 * Verdict list query — owns polling cadence (1s, D3), visibility pause,
 * the 250ms resume debounce (D4), and `If-None-Match`/304 plumbing
 * (D11, feature spec line 59).
 *
 * `staleTime: 500` (D5) deduplicates re-render-triggered refetches
 * against the 1s cadence. `refetchOnMount: false` (D11) avoids the
 * stampede when the timeline remounts (e.g., kind-tab switch in PRP 05
 * step 9). React Query owns the `setInterval` (D12) — the component
 * never calls one.
 *
 * On 304 the queryFn returns the previously-cached payload so React
 * Query treats the row set as unchanged and consumers don't re-render
 * over identity-equal data. The etagRef is only advanced on a 200 or a
 * 304 that re-states the same validator — never on an error (PRP 05
 * step 5), so the next call retries with the last good etag.
 */
export type VerdictsQueryArgs = ListVerdictsParams;

const POLL_MS = 1000;
const VISIBILITY_DEBOUNCE_MS = 250;

export function useVerdictsQuery(
  args: VerdictsQueryArgs,
): UseQueryResult<ListVerdictsResult, Error> {
  const qc = useQueryClient();
  // Reference-stable queryKey across renders so the visibility effect
  // doesn't tear down and re-register every state-tick — that would
  // clear the debounce timer mid-flight and the 5x-toggle test would
  // pass for the wrong reason.
  const argsKey = JSON.stringify(args);
  const queryKey = useMemo<QueryKey>(() => ["verdicts", args], [argsKey]);
  // ETag is per-queryKey: a verdict-kind filter and a profile_job_dlq
  // filter validate to different bodies, and a stale etag from one
  // would force a falsy 304 on the other. Keep refs keyed by argsKey
  // so a tab toggle (D6) starts the new query with `If-None-Match`
  // unset.
  const etagByKey = useRef<Map<string, string>>(new Map());
  const lastBodyByKey = useRef<Map<string, ListVerdictsResult>>(new Map());

  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const etag = etagByKey.current.get(argsKey) ?? null;
      const result = await fetchVerdicts(args, etag, { signal });
      if (result.status === 304) {
        return (
          lastBodyByKey.current.get(argsKey) ?? { rows: [], nextCursor: null }
        );
      }
      if (result.etag !== null) etagByKey.current.set(argsKey, result.etag);
      if (result.body !== null) lastBodyByKey.current.set(argsKey, result.body);
      return result.body ?? { rows: [], nextCursor: null };
    },
    refetchInterval: () =>
      document.visibilityState === "hidden" ? false : POLL_MS,
    staleTime: 500,
    refetchOnMount: false,
  });

  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | undefined;
    const onVisibilityChange = (): void => {
      if (pending !== undefined) {
        clearTimeout(pending);
        pending = undefined;
      }
      if (document.visibilityState === "hidden") {
        void qc.cancelQueries({ queryKey });
        return;
      }
      pending = setTimeout(() => {
        void qc.refetchQueries({ queryKey });
      }, VISIBILITY_DEBOUNCE_MS);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      if (pending !== undefined) clearTimeout(pending);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [qc, queryKey]);

  return query;
}
