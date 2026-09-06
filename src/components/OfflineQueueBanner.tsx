import { useEffect } from 'react'
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
export function OfflineQueueBanner({ redact }: { redact: boolean }) {
  const { pending, halted } = useOfflineQueue()

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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M12 3 L22 20 L2 20 Z" strokeLinejoin="round" />
          <line x1="12" y1="9" x2="12" y2="14" strokeLinecap="round" />
          <circle cx="12" cy="17" r="0.5" fill="currentColor" />
        </svg>
        {redact ? (
          <>A queued save could not go through. Sign in and unlock to see details. Do not close this device.</>
        ) : (
          <>
            A queued save could not go through ({halted.error}) — {halted.mutation.description}. It needs a person to look
            at it before anything queued after it can sync. Do not close this device.
          </>
        )}
      </div>
    )
  }

  if (pending.length === 0) return null

  return (
    <div className="offline-queue-banner offline-queue-banner-pending" role="status">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <polyline points="21 3 21 9 15 9" />
      </svg>
      {pending.length} not saved yet — waiting for a connection. Do not close this device until this clears.
    </div>
  )
}
