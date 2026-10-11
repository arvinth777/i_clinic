import { createContext, useContext } from 'react'

export const RealtimeConnected = createContext(false)
export const queuePollInterval = (connected: boolean) => connected ? 30_000 : 3_000
export function useQueuePollInterval() { return queuePollInterval(useContext(RealtimeConnected)) }

// Coalesce a burst of WAL events; authoritative reads still happen within 100ms.
export function batchRealtimeEvents(refetch: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    notify() { timer ??= setTimeout(() => { timer = undefined; refetch() }, 100) },
    close() { clearTimeout(timer) },
  }
}
