import { useEffect, useState } from 'react'
import { MAX_ATTEMPTS, hasPin, setScreenLocked, verifyPin } from '../lib/pinLock'
import { supabase } from '../lib/supabase'
import { Button } from './ui/button'
import { lockPageScroll } from '../lib/scrollLock'
import './LockScreen.css'

// Requirement 12 (docs/architecture-spec.md): renders no application
// state at all -- no patient name, queue, token, or amount, not even a
// glimpse. Deliberately not a Drawer: a Drawer closes on Escape or a
// scrim click, which a lock screen must never do -- only a correct PIN
// dismisses this. The app underneath stays mounted the whole time (this
// component returns null rather than the caller conditionally mounting
// it), so locking never discards an in-progress draft.
export function LockScreen({ locked, onUnlock }: { locked: boolean; onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  // Freeze the page behind the lock: its scrollbar would otherwise show through and pull the lock off-centre.
  useEffect(() => (locked ? lockPageScroll() : undefined), [locked])

  if (!locked) return null

  // Signing out is the recovery path: no PIN on this device (cleared storage)
  // or too many wrong tries. The real password is then required.
  async function signOut() {
    setScreenLocked(false)
    await supabase.auth.signOut()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setChecking(true)
    const result = await verifyPin(pin)
    setChecking(false)
    if (result.ok) {
      setPin('')
      setError('')
      setScreenLocked(false)
      onUnlock()
    } else if (result.attempts >= MAX_ATTEMPTS) {
      await signOut()
    } else {
      setPin('')
      setError(result.waitMs ? `Too many tries. Wait ${Math.ceil(result.waitMs / 1000)}s.` : 'Wrong PIN.')
    }
  }

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Screen locked">
      <form className="lock-screen-form" onSubmit={submit}>
        <p className="lock-screen-label">Locked</p>
        {hasPin() ? (
          <>
            <input
              type="password"
              inputMode="numeric"
              aria-label="PIN"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN"
              className="lock-screen-input"
            />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={checking || !pin}>
              {checking ? 'Checking…' : 'Unlock'}
            </Button>
          </>
        ) : (
          <Button type="button" onClick={() => void signOut()}>
            Sign in again
          </Button>
        )}
      </form>
    </div>
  )
}
