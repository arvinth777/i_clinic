import { useEffect, useState } from 'react'
import { listUploads, subscribeUploads } from './documentUploads'
import { getHalted, getQueueSnapshot, subscribeQueue, type HaltedMutation, type QueuedMutation } from './offlineQueue'

// Backs the unmissable "unsynced work" banner (requirement 6) -- a badge
// nobody has to notice isn't enough for a machine that gets switched off
// every evening, so this is polled/subscribed everywhere the shell renders,
// not just on the screen that happened to queue something.
type PendingSave = Pick<QueuedMutation, 'id' | 'ownerId' | 'clinicId' | 'description'>
export function useOfflineQueue(): { pending: PendingSave[]; halted: HaltedMutation | null } {
  const [pending, setPending] = useState<PendingSave[]>([])
  const [halted, setHalted] = useState<HaltedMutation | null>(getHalted())

  useEffect(() => {
    let mounted = true
    function refresh() {
      Promise.all([getQueueSnapshot(), listUploads()]).then(([q, files]) => {
        if (mounted) setPending([...q, ...files.map(file => ({ id: file.id, ownerId: file.ownerId, clinicId: file.clinicId, description: 'Upload patient document' }))])
      })
      setHalted(getHalted())
    }
    refresh()
    const unsubscribe = subscribeQueue(refresh)
    const unsubscribeFiles = subscribeUploads(refresh)
    return () => {
      mounted = false
      unsubscribe()
      unsubscribeFiles()
    }
  }, [])

  return { pending, halted }
}
