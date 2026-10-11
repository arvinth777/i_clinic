import { useEffect, useState } from 'react'
import { getHalted, getQueueSnapshot, subscribeQueue, type HaltedMutation, type QueuedMutation } from './offlineQueue'

// Backs the unmissable "unsynced work" banner (requirement 6) -- a badge
// nobody has to notice isn't enough for a machine that gets switched off
// every evening, so this is polled/subscribed everywhere the shell renders,
// not just on the screen that happened to queue something.
export function useOfflineQueue(): { pending: QueuedMutation[]; halted: HaltedMutation | null } {
  const [pending, setPending] = useState<QueuedMutation[]>([])
  const [halted, setHalted] = useState<HaltedMutation | null>(getHalted())

  useEffect(() => {
    let mounted = true
    function refresh() {
      getQueueSnapshot().then((q) => {
        if (mounted) setPending(q)
      })
      setHalted(getHalted())
    }
    refresh()
    const unsubscribe = subscribeQueue(refresh)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  return { pending, halted }
}
