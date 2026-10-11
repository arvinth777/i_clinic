import { useState } from 'react'
import { verifyPin } from '../lib/pinLock'
import { Button } from './ui/button'
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

  if (!locked) return null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setChecking(true)
    const ok = await verifyPin(pin)
    setChecking(false)
    if (ok) {
      setPin('')
      setError('')
      onUnlock()
    } else {
      setError('Wrong PIN.')
    }
  }

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label="Screen locked">
      <form className="lock-screen-form" onSubmit={submit}>
        <p className="lock-screen-label">Locked</p>
        <input
          type="password"
          inputMode="numeric"
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
      </form>
    </div>
  )
}
