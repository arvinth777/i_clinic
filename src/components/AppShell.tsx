import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { onlineManager, useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useClinicId } from '../lib/useClinicId'
import { useTheme } from '../lib/useTheme'
import { useOfflineQueue } from '../lib/useOfflineQueue'
import { useIdleTimer } from '../lib/useIdleTimer'
import { hasPin, setPin } from '../lib/pinLock'
import { LockScreen } from './LockScreen'
import { Drawer } from './Drawer'
import { Button } from './ui/button'
import { Input } from './ui/input'
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
        <Input id="new-pin" type="password" inputMode="numeric" value={pin} onChange={(e) => setPinDraft(e.target.value)} autoFocus />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="confirm-pin">
          Confirm PIN
        </label>
        <Input id="confirm-pin" type="password" inputMode="numeric" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="action-row">
        <Button type="submit">Save PIN</Button>
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
  const { pending, halted } = useOfflineQueue()
  const saving = useIsMutating()
  const online = useSyncExternalStore(onlineManager.subscribe, () => onlineManager.isOnline())
  const queryClient = useQueryClient()
  const clinical = sections.some((section) => section.key === 'consultation' || section.key === 'reception')
  const queueKey = ['shell-queue', clinicId]
  const { data: queue, isError: queueError } = useQuery({
    queryKey: queueKey,
    enabled: !!clinicId && clinical,
    queryFn: async () => {
      const { data, error } = await supabase.from('visits').select('token_number, stage')
        .eq('clinic_id', clinicId!).in('stage', ['waiting', 'with_doctor'])
      if (error) throw error
      return data
    },
  })
  useEffect(() => {
    if (!clinicId || !clinical) return
    const channel = supabase.channel(`shell-queue-${clinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `clinic_id=eq.${clinicId}` },
        () => { queryClient.invalidateQueries({ queryKey: ['shell-queue', clinicId] }) })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [clinicId, clinical, queryClient])
  const current = queue?.find((visit) => visit.stage === 'with_doctor')
  const primary = sections.filter((section) => ['reception', 'consultation', 'pharmacy', 'stock', 'reports'].includes(section.key))
  const more = sections.filter((section) => !primary.includes(section))
  const activeMore = more.find((section) => section.key === activeSection)

  useIdleTimer(pinSet, isDoctor ? DOCTOR_TIMEOUT_MS : OTHER_TIMEOUT_MS, onLock)

  function navItem(section: ShellSection) {
    return <button key={section.key} type="button" className="shell-nav-item"
      aria-current={section.key === activeSection ? 'page' : undefined}
      onClick={(event) => {
        onSelectSection(section.key)
        event.currentTarget.closest('details')?.removeAttribute('open')
      }}>{section.label}</button>
  }

  return (
    <div className="shell">
      <header className="shell-header">
        <span className="shell-clinic-name" title={clinicName}>{clinicName ?? 'Clinic'}</span>
        <nav className="shell-nav" aria-label="Main">
          {primary.map(navItem)}
          {more.length > 0 && <details className="shell-menu">
            <summary className="shell-nav-item" aria-current={activeMore ? 'page' : undefined}>{activeMore?.label ?? 'More'} <span aria-hidden="true">⌄</span></summary>
            <div className="shell-menu-items">{more.map(navItem)}</div>
          </details>}
        </nav>
        <div className="shell-status">
          {clinical && <span className="shell-queue" title={online ? 'Shared clinic queue' : 'Last saved queue · offline'}>
            <span className={online ? 'shell-status-dot' : 'shell-status-dot offline'} aria-hidden="true" />
            <strong>{queueError ? 'Queue unavailable' : !queue ? 'Loading queue…' : current ? `Now #${current.token_number}` : 'No active token'}</strong>
            {queue && <span>{queue.filter((visit) => visit.stage === 'waiting').length} waiting</span>}
          </span>}
          <span className={pending.length || halted || !online ? 'shell-sync pending' : 'shell-sync'} role="status">
            {halted ? 'Save needs attention' : !online ? `Offline · ${pending.length} pending` : pending.length ? `${pending.length} not saved yet` : saving ? 'Saving…' : 'No pending saves'}
          </span>
          <details className="shell-menu shell-account">
            <summary className="shell-nav-item" title={userEmail}>{isDoctor ? 'Doctor' : clinical ? 'Reception' : 'Admin'} <span aria-hidden="true">⌄</span></summary>
            <div className="shell-menu-items">
              <span className="shell-user-email">{userEmail}</span>
              <button className="shell-nav-item" onClick={toggleTheme}>{theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}</button>
              <button className="shell-nav-item" onClick={() => setShowPinForm(true)}>{pinSet ? 'Change lock PIN' : 'Set a lock PIN'}</button>
              <button className="shell-nav-item" onClick={() => supabase.auth.signOut()}>Sign out</button>
            </div>
          </details>
          <button type="button" className="shell-nav-item" onClick={() => pinSet ? onLock() : setShowPinForm(true)}>Lock</button>
        </div>
      </header>
      <Drawer open={showPinForm} onClose={() => setShowPinForm(false)} title={pinSet ? 'Change lock PIN' : 'Set a lock PIN'}>
        <PinForm onDone={() => { setPinSet(true); setShowPinForm(false) }} />
      </Drawer>
      <LockScreen locked={locked} onUnlock={onUnlock} />
      <main className="shell-content">
        {activeSection ? children : <p className="readout-empty">This account has no role assigned at this clinic. Contact your admin to get access.</p>}
      </main>
    </div>
  )
}
