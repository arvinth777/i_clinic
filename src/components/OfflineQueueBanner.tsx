import { useEffect, useSyncExternalStore } from 'react'
import { onlineManager, useQueryClient } from '@tanstack/react-query'
import { discardHalted, drainQueue, retryHalted } from '../lib/offlineQueue'
import { useConfirm } from '../lib/confirm'
import { useOfflineQueue } from '../lib/useOfflineQueue'
import './OfflineQueueBanner.css'

// Requirement 6: unsynced work must be unmissable before shutdown, not a
// subtle badge. This is part of the app shell's chrome -- rendered on
// every screen, not just the one that happened to queue something -- and
// non-dismissable for as long as anything is pending, the same way
// StagingBanner is a fact of the screen rather than a toast that goes away.
// beforeunload is a best-effort second layer, not the primary mechanism:
// it shows generic browser text this component can't customise, and
// doesn't fire reliably on every close path (OS shutdown, killed process).
export function OfflineQueueBanner({ redact, userId }: { redact: boolean; userId?: string }) {
  const { pending, halted } = useOfflineQueue()
  const online = useSyncExternalStore(onlineManager.subscribe, () => onlineManager.isOnline())
  const client = useQueryClient()
  const confirm = useConfirm()
  function retry() { void drainQueue(); void client.invalidateQueries() }
  async function discard() {
    if (!halted) return
    const id = halted.mutation.id
    if (!(await confirm({ title: 'Discard this change?', body: `"${halted.mutation.description}" was never saved and will be lost. Changes queued after it will then sync.`, confirmLabel: 'Discard' }))) return
    await discardHalted(id)
    void client.invalidateQueries()
  }

  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (pending.length === 0) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [pending.length])

  if (halted) {
    // mutation.description embeds the patient's real name at several call
    // sites (Consultation.tsx, Billing.tsx, Reception.tsx) -- fine to show
    // to a signed-in, unlocked member of staff, but this banner is
    // deliberately also mounted on the signed-out screen (the queue
    // survives sign-out) and stays rendered underneath the lock screen.
    // `redact` is true in both of those states -- the warning itself must
    // still be unmissable (requirement 6), just without naming anyone.
    return (
      <div className="offline-queue-banner offline-queue-banner-halted" role="alert">
        {redact || !halted.mutation.ownerId || halted.mutation.ownerId !== userId ? (
          <>A queued save could not go through. Its original account must review it. Do not close this device.</>
        ) : (
          <>
            A queued save could not go through ({halted.error}) — {halted.mutation.description}. Nothing queued after it
            can sync until you retry it or discard it. Do not close this device.
            <button className="ui-button ui-button-neutral" onClick={() => void retryHalted()}>Retry</button>
            <button className="ui-button ui-button-neutral" onClick={() => void discard()}>Discard this change</button>
          </>
        )}
      </div>
    )
  }

  if (!online) return <div className="offline-queue-banner offline-queue-banner-halted" role="status"><span>Offline · Saved records and printing still work. New changes stay on this device until they sync. {pending.length} changes waiting.</span><button className="ui-button ui-button-neutral" onClick={retry}>Try again</button></div>
  if (pending.length === 0) return null

  return (
    <div className="offline-queue-banner offline-queue-banner-pending" role="status">
      {pending.length} not saved yet — {pending.some((mutation) => mutation.ownerId && mutation.ownerId !== userId)
        ? 'pending work from another account needs that account to sign in.'
        : 'waiting for a connection.'} Do not close this device until this clears.
    </div>
  )
}
