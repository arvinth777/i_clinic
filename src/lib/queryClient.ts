import { QueryClient } from '@tanstack/react-query'

// Realtime is not the source of truth (AGENTS.md non-negotiable #6): a
// change event invalidates a query and triggers a refetch here, it never
// patches state from the payload. This interval is a backstop, not the
// sync path -- Realtime now genuinely pushes sub-second (confirmed live:
// 20260906180000_enable_realtime_publication.sql fixed a publication that
// had never actually included visits/visit_pricing/bills, so nothing had
// ever been pushed; every "sync" before that was this poll catching up).
// 30s keeps the backstop cheap (two concurrent users, ~30s apart, is
// nothing) while refetchOnWindowFocus covers the case a poll interval
// can't -- a laptop that slept and dropped the socket, caught the moment
// the screen is looked at again, not up to 30s later.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchInterval: 30_000,
    },
  },
})
