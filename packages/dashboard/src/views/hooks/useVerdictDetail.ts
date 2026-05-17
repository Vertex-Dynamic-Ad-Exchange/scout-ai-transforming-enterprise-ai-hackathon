import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { AuditRow } from "@scout/shared";
import { getVerdict } from "../../api/client.js";

/**
 * Single-verdict detail query (PRP 06 Task 6 + Out-of-scope §
 * "Real-time updates").
 *
 * Verdict rows are immutable once the gate writes them
 * (`features/clusterA/gate-verdict-logic.md:97`), so the detail panel
 * does NOT poll: `staleTime: Infinity` + `refetchOnMount: false`. The
 * Timeline (PRP 05) owns the 1s polling cadence for the list view —
 * this hook only refetches when the user explicitly hits Retry.
 *
 * `id === null` disables the query entirely so React Query doesn't
 * fire a request for a `:id` of "null" before the Drilldown's
 * early-return shows up.
 *
 * Backend 404 (cross-tenant or missing) bubbles as `isError: true`;
 * the route enforces enumeration-safe 404 (feature spec line 43), so
 * the dashboard treats "not yours" and "doesn't exist" identically.
 */
export function useVerdictDetail(
  id: string | null,
): UseQueryResult<AuditRow, Error> {
  return useQuery({
    queryKey: ["verdict-detail", id],
    enabled: id !== null,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      if (id === null) {
        // React Query won't actually call this when `enabled: false`,
        // but the type system needs a return path. Throw rather than
        // returning a fake row — the consumer's `isLoading` branch
        // covers the disabled state.
        throw new Error("useVerdictDetail: id is null");
      }
      const row = await getVerdict(id, { signal });
      if (row === null) {
        throw new Error(`verdict ${id} not found`);
      }
      return row;
    },
  });
}
