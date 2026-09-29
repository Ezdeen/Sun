/**
 * Live data by default: every query re-fetches on an interval, on tab focus
 * and when the network returns — so no page needs a manual reload.
 *  • Polling pauses in a hidden tab (react-query default) — no wasted load.
 *  • After a failed fetch we back off instead of hammering a struggling API.
 *  • Static or public data opts out / slows down with an explicit per-query
 *    `refetchInterval` (e.g. the catalog, or the rate-limited public tracker).
 */
import { QueryClient, type Query } from "@tanstack/react-query";

export const POLL_MS = 20_000;
export const POLL_BACKOFF_MS = 60_000;

export function pollInterval(query: Query): number {
  return query.state.status === "error" ? POLL_BACKOFF_MS : POLL_MS;
}

export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 10_000,
        refetchInterval: pollInterval,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true
      }
    }
  });
  // Rarely-changing reference data: slow poll (also keeps form selects calm).
  client.setQueryDefaults(["catalog"], { refetchInterval: 60_000 });
  // Public tracker is capped at 20 req/min per IP server-side: stay well below.
  client.setQueryDefaults(["track"], { refetchInterval: 30_000 });
  return client;
}
