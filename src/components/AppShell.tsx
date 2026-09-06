import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useClinicId } from '../lib/useClinicId'
import { useTheme } from '../lib/useTheme'
import { useIdleTimer } from '../lib/useIdleTimer'
import { hasPin, setPin } from '../lib/pinLock'
import { LockScreen } from './LockScreen'
import { Drawer } from './Drawer'
import './AppShell.css'

// Per-station idle-lock timeout (docs/architecture-spec.md): the reception
// desk is a walk-through space, unattended repeatedly through the day; the
// doctor's console is a controlled consultation room where a short timer
// would just get disabled by the person it's meant to protect. Derived
// from role, not a physical station setting -- this is a login session,
// not a kiosk. A doctor holding admin too (docs/STATUS.md's documented
// roster) still gets the doctor's longer window.
const DOCTOR_TIMEOUT_MS = 15 * 60 * 1000
const OTHER_TIMEOUT_MS = 2 * 60 * 1000

function PinForm({ onDone }: { onDone: () => void }) {
  const [pin, setPinDraft] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{4,6}$/.test(pin)) {
      setError('PIN must be 4 to 6 digits.')
      return
    }
    if (pin !== confirm) {
      setError("PINs don't match.")
      return
    }
    await setPin(pin)
    onDone()
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label className="field-label" htmlFor="new-pin">
          New PIN (4-6 digits)
        </label>
        <input id="new-pin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPinDraft(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="confirm-pin">
          Confirm PIN
        </label>
        <input id="confirm-pin" type="password" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="action-row">
        <button type="submit" className="primary-button">
          Save PIN
        </button>
      </div>
    </form>
  )
}

function useClinicName(clinicId: string | null | undefined) {
  return useQuery({
    queryKey: ['clinic-name', clinicId],
    enabled: !!clinicId,
    queryFn: async () => {
      const { data, error } = await supabase.from('clinics').select('name').eq('id', clinicId).single()
      if (error) throw error
      return data.name as string
    },
  })
}

export type ShellSection = { key: string; label: string }

export function AppShell({
  userId,
  userEmail,
  isDoctor,
  locked,
  onLock,
  onUnlock,
  sections,
  activeSection,
  onSelectSection,
  children,
}: {
  userId: string
  userEmail: string | undefined
  isDoctor: boolean
  // Owned by App.tsx, not here: OfflineQueueBanner (a sibling of this
  // shell, not a child) needs the same "locked" fact to redact a
  // patient's name from a halted-queue message while the screen is
  // locked (docs/STATUS.md) -- a single shared source of truth, not two
  // components independently tracking whether the screen is locked.
  locked: boolean
  onLock: () => void
  onUnlock: () => void
  sections: ShellSection[]
  activeSection: string
  onSelectSection: (key: string) => void
  children: ReactNode
}) {
  const { data: clinicId } = useClinicId(userId)
  const { data: clinicName } = useClinicName(clinicId)
  const { theme, toggleTheme } = useTheme()

  const [pinSet, setPinSet] = useState(hasPin())
  const [showPinForm, setShowPinForm] = useState(false)

  useIdleTimer(pinSet, isDoctor ? DOCTOR_TIMEOUT_MS : OTHER_TIMEOUT_MS, onLock)

  return (
    <div className="shell">
      <div className="shell-header">
        <span className="shell-clinic-name">{clinicName ?? ' '}</span>
        {sections.length > 0 && (
          <nav className="shell-nav">
            {sections.map((s) => (
              <button
                key={s.key}
                type="button"
                className={s.key === activeSection ? 'shell-nav-item active' : 'shell-nav-item'}
                onClick={() => onSelectSection(s.key)}
              >
                {s.label}
              </button>
            ))}
          </nav>
        )}
        <div className="shell-header-spacer" />
        <button
          type="button"
          className="shell-theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <button type="button" className="shell-theme-toggle" onClick={() => setShowPinForm(true)} aria-label={pinSet ? 'Change lock PIN' : 'Set a lock PIN'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="11" width="16" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </button>
        {pinSet && (
          <button type="button" className="shell-theme-toggle" onClick={onLock} aria-label="Lock screen now">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="4" y="11" width="16" height="9" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        <span className="shell-user-email">{userEmail}</span>
        <button type="button" className="shell-signout" onClick={() => supabase.auth.signOut()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className="shell-signout-label">Sign out</span>
        </button>
      </div>
      <Drawer open={showPinForm} onClose={() => setShowPinForm(false)} title={pinSet ? 'Change lock PIN' : 'Set a lock PIN'}>
        <PinForm
          onDone={() => {
            setPinSet(true)
            setShowPinForm(false)
          }}
        />
      </Drawer>
      <LockScreen locked={locked} onUnlock={onUnlock} />
      <div className="shell-content">
        {activeSection ? (
          children
        ) : (
          <p className="readout-empty">This account has no role assigned at this clinic. Contact your admin to get access.</p>
        )}
      </div>
    </div>
  )
}
