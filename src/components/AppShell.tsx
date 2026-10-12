import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { onlineManager, useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useClinicId } from '../lib/useClinicId'
import { useOfflineQueue } from '../lib/useOfflineQueue'
import { useIdleTimer } from '../lib/useIdleTimer'
import { hasPin, setPin } from '../lib/pinLock'
import { ClinicAlerts } from './ClinicAlerts'
import type { AlertTarget } from '../lib/clinicAlerts'
import { useCallSound } from './CallSound'
import { LockScreen } from './LockScreen'
import { Drawer } from './Drawer'
import { OfflineQueueBanner } from './OfflineQueueBanner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import './AppShell.css'
import { startOfToday } from '../lib/date'
import { RealtimeConnected, queuePollInterval, batchRealtimeEvents } from '../lib/realtimeStatus'

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
  onOpenAlert,
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
  onOpenAlert: (target: AlertTarget) => void
  children: ReactNode
}) {
  const { data: clinicId } = useClinicId(userId)
  const { data: clinicName } = useClinicName(clinicId)
  const header = useRef<HTMLElement>(null)
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }) }, [activeSection])
  const [menuOpen, setMenuOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!header.current) return
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty('--header-current-height', `${entry.target.getBoundingClientRect().height}px`)
    })
    observer.observe(header.current)
    return () => observer.disconnect()
  }, [])

  const [pinSet, setPinSet] = useState(hasPin())
  const [showPinForm, setShowPinForm] = useState(false)
  const { pending, halted } = useOfflineQueue()
  const saving = useIsMutating()
  const online = useSyncExternalStore(onlineManager.subscribe, () => onlineManager.isOnline())
  const queryClient = useQueryClient()
  const clinical = sections.some((section) => section.key === 'consultation' || section.key === 'reception')
  const queueKey = ['shell-queue', clinicId]
  const { data: queue, isError: queueError } = useQuery({
    queryKey: queueKey, refetchInterval:queuePollInterval(connected),
    enabled: !!clinicId && clinical,
    queryFn: async () => {
      const { data, error } = await supabase.from('visits').select('id, token_number, stage, arrived_at, queue_position, called_at, sent_in_at')
        .eq('clinic_id', clinicId!).in('stage', ['waiting', 'called', 'with_doctor']).gte('arrived_at', startOfToday())
      if (error) throw error
      return data
    },
  })
  useEffect(() => {
    if (!clinicId || !clinical) return
    function refreshQueue() {
      for (const key of ['shell-queue', 'queue-events', 'doctor-queue', 'doctor-alert-visit', 'visits-today', 'visits-earlier', 'doctor-discount-requests', 'doctor-earlier-count', 'doctor-today-metrics', 'clinic-alerts']) {
        void queryClient.invalidateQueries({ queryKey: [key, clinicId] })
      }
    }
    const events = batchRealtimeEvents(refreshQueue)
    const channel = supabase.channel(`shell-queue-${clinicId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `clinic_id=eq.${clinicId}` }, events.notify)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'queue_events', filter: `clinic_id=eq.${clinicId}` }, events.notify)
      .subscribe(status => {
        setConnected(status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') refreshQueue()
      })
    return () => { events.close(); supabase.removeChannel(channel) }
  }, [clinicId, clinical, queryClient])
  const {data: latestEvent}=useQuery({queryKey:['queue-events',clinicId,userId],refetchInterval:queuePollInterval(connected),enabled:!!clinicId&&clinical,queryFn:async()=>{
    const {data,error}=await supabase.from('queue_events').select('id,visit_id,action,created_at,visits(token_number)').eq('clinic_id',clinicId!).neq('actor_id',userId).gte('created_at',new Date(Date.now()-10000).toISOString()).in('action',['call','sent_in','finish','request_discount']).order('created_at',{ascending:false}).limit(1).maybeSingle()
    if(error)throw error
    return data as {id:string;visit_id:string;action:string;created_at:string;visits:{token_number:number}}|null
  }})
  const soundControl = useCallSound({ event: latestEvent, userId, clinicId: clinicId ?? '', locked, available: !isDoctor && clinical })
  const [expiredEvent,setExpiredEvent]=useState<string|null>(null)
  const eventTime=latestEvent?.created_at
  const eventVisible=!!eventTime&&expiredEvent!==eventTime
  useEffect(()=>{if(!eventTime)return;const remaining=new Date(eventTime).getTime()+10000-Date.now();const timer=setTimeout(()=>setExpiredEvent(eventTime),Math.max(0,remaining));return()=>clearTimeout(timer)},[eventTime])
  const eventText=latestEvent && ({call:'Doctor called',sent_in:'Reception sent in',finish:'Ready to bill',request_discount:'Discount review requested'}[latestEvent.action])
  const current = queue?.find((visit) => ['called','with_doctor'].includes(visit.stage))
  const primary = ['reception', 'consultation', 'billing', 'pharmacy', 'patients', 'stock', 'reports'].flatMap(key => sections.filter(section => section.key === key))
  const more = sections.filter((section) => !primary.includes(section))
  const activeMore = more.find((section) => section.key === activeSection)

  useIdleTimer(isDoctor ? DOCTOR_TIMEOUT_MS : OTHER_TIMEOUT_MS, onLock)
  useEffect(() => { const label = sections.find((s) => s.key === activeSection)?.label; document.title = label ? `${label} · iClinic` : 'iClinic' }, [sections, activeSection])

  function select(key: string) { onSelectSection(key); setMenuOpen(false) }
  function navItem(section: ShellSection) {
    return <a key={section.key} href={`#${section.key}`} className="shell-nav-item"
      aria-current={section.key === activeSection || (section.key === 'more' && activeMore) ? 'page' : undefined}
      onClick={(event) => { event.preventDefault(); select(section.key) }}>{section.label}</a>
  }
  const navigation = [...primary, { key: 'more', label: 'More' }]
  const syncLabel = halted ? 'Save needs attention' : !online ? `Offline · ${pending.length} changes waiting` : pending.length ? `${pending.length} not saved yet` : saving ? 'Saving…' : 'All saved'
  const sync = <span className={`shell-sync ${halted || !online ? 'pending' : pending.length || saving ? 'saving' : ''}`} role="status">{syncLabel}</span>
  const queueLink = clinical && <a href="#reception" onClick={e => { e.preventDefault(); select('reception') }} className="shell-queue" title={online && connected ? 'Live clinic queue' : 'Showing the saved queue; reconnecting'}>
    <span className={online && connected ? 'shell-status-dot' : 'shell-status-dot offline'} aria-hidden="true" />
    <strong>{queueError && !queue ? 'Queue unavailable' : !queue ? 'Loading queue…' : current ? `Now #${current.token_number}` : 'No active token'}</strong>
    {queue && <span>{queue.filter((visit) => visit.stage === 'waiting').length} waiting</span>}
  </a>
  const account = <details className="shell-menu shell-account">
    <summary className="shell-nav-item" title={userEmail}>{isDoctor ? 'Doctor' : clinical ? 'Reception' : 'Admin'} ▾</summary>
    <div className="shell-menu-items">
      <span className="shell-user-email">{userEmail}</span>
      <button className="shell-nav-item" onClick={() => { setMenuOpen(false); setShowPinForm(true) }}>{pinSet ? 'Change lock PIN' : 'Set a lock PIN'}</button>
      <button className="shell-nav-item" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  </details>
  return (
    <RealtimeConnected value={connected}><div className="shell">
      <header ref={header} className="shell-header">
        <a className="shell-clinic-name" href={isDoctor ? '#consultation' : '#reception'} onClick={e => { e.preventDefault(); select(isDoctor ? 'consultation' : sections[0]?.key ?? '') }}>{clinicName ?? ''}</a>
        <nav className="shell-nav no-scrollbar" aria-label="Main">{navigation.map(navItem)}</nav>
        <div className="shell-status">
          {eventVisible && eventText && <span className="shell-event" role="status">{eventText} #{latestEvent?.visits.token_number}</span>}
          {clinical && <button className="shell-nav-item" onClick={() => setAlertsOpen(true)}>Alerts</button>}
          {queueLink}
          {sync}
          {account}
          <button type="button" className="shell-nav-item shell-lock" onClick={() => pinSet ? onLock() : setShowPinForm(true)}>Lock</button>
        </div>
        <button className="shell-nav-item shell-mobile-toggle" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen}>Menu ▾</button>
      </header>
      {clinical && clinicId && <ClinicAlerts key={`${clinicId}:${userId}`} open={alertsOpen} onClose={() => setAlertsOpen(false)} onOpen={target => { if (sections.some(section => section.key === target.section)) onOpenAlert(target) }} clinicId={clinicId} userId={userId} isDoctor={isDoctor} online={online} connected={connected} locked={locked} soundControl={soundControl} />}
      <OfflineQueueBanner userId={userId} redact={locked || !clinical} />
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" placement="top">
        {queueLink}
        {sync}
        {clinical && <button className="shell-nav-item" onClick={() => { setMenuOpen(false); setAlertsOpen(true) }}>Alerts</button>}
        <nav className="shell-mobile-links" aria-label="Main menu">{navigation.map(navItem)}</nav>
        {account}
        <button type="button" className="shell-nav-item" onClick={() => { setMenuOpen(false); if (pinSet) onLock(); else setShowPinForm(true) }}>Lock</button>
      </Drawer>
      <Drawer open={showPinForm} onClose={() => setShowPinForm(false)} title={pinSet ? 'Change lock PIN' : 'Set a lock PIN'}>
        <PinForm onDone={() => { setPinSet(true); setShowPinForm(false) }} />
      </Drawer>
      <LockScreen locked={locked} onUnlock={onUnlock} />
      <main className="shell-content">
        {activeSection ? ((activeMore && !['admin', 'suppliers'].includes(activeSection)) || activeSection === 'more' ? <div className="support-layout"><aside className="record-sidebar"><h2 className="readout-heading">More</h2>{more.map(navItem)}</aside><div className="support-content">{activeSection === 'more' ? <><h1>More</h1><p className="readout-empty">Choose a tool from the list.</p><p className="field-hint">{clinicName}</p></> : children}</div></div> : children) : <p className="readout-empty">This account has no role assigned at this clinic. Contact your admin to get access.</p>}
      </main>
    </div></RealtimeConnected>
  )
}
