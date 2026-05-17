import { QueryClient } from "@tanstack/react-query";

/**
 * Dashboard-wide React Query defaults (D10).
 *
 * `staleTime: 500` deduplicates the 1s polling cadence PRP 05's
 * `VerdictTimeline` mounts (`features/clusterD/dashboard-verdict-views.md:166`)
 * against re-renders. `refetchOnMount: false` and
 * `refetchOnWindowFocus: false` prevent stampedes when the user
 * tab-switches or a panel remounts.
 *
 * Visibility-state polling-pause (feature spec line 113) is implemented
 * **per-query** in PRP 05 via `refetchInterval: () =>
 * document.visibilityState === "hidden" ? false : 1000`, NOT globally —
 * a global setting would silently break any future view that polls at
 * a different cadence. Keep the per-query knob; do not promote it.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 500,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  },
});
