import { createStore, get, set, del } from 'idb-keyval'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { queryClient } from './queryClient'

// Persisted reads (AGENTS.md offline decision, requirement 1): today's
// queue, patient list, and whatever else this device already fetched
// survive a refresh. A separate idb-keyval store from the mutation queue's
// own (offlineQueue.ts) -- this one has a maxAge and can be evicted by the
// browser under storage pressure; the queue must never be.
const store = createStore('offline-reads-db', 'query-cache')

const idbStorage = {
  getItem: (key: string) => get<string>(key, store),
  setItem: (key: string, value: string) => set(key, value, store),
  removeItem: (key: string) => del(key, store),
}

export const persister = createAsyncStoragePersister({
  storage: idbStorage,
  key: 'i-clinic-query-cache',
  throttleTime: 1000,
})

// A day: long enough to survive an overnight power cut or a machine left
// off over a weekend close, short enough that a cache nobody ever
// refreshed doesn't quietly go stale for a week.
const MAX_AGE_MS = 1000 * 60 * 60 * 24

export function setupPersistedQueryClient() {
  persistQueryClient({ queryClient, persister, maxAge: MAX_AGE_MS })
}
