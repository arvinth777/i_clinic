import { createContext, useContext } from 'react'

export const RealtimeConnected = createContext(false)
export const queuePollInterval = (connected: boolean) => connected ? 30_000 : 3_000
export function useQueuePollInterval() { return queuePollInterval(useContext(RealtimeConnected)) }
