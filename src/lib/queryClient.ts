import { QueryClient } from '@tanstack/react-query'

// Realtime is not the source of truth (AGENTS.md non-negotiable #6): a
// change event invalidates a query and triggers a refetch here, it never
// patches state from the payload. refetchOnWindowFocus plus a modest
// interval cover a socket that's silently dropped (laptop sleep, wifi
// flap) until the next invalidation self-heals it.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchInterval: 20_000,
    },
  },
})
