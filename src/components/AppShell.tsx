import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useClinicId } from '../lib/useClinicId'
import { useOfflineQueue } from '../lib/useOfflineQueue'
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
import { startOfToday, clinicToday } from '../lib/date'
import { RealtimeConnected, queuePollInterval, batchRealtimeEvents } from '../lib/realtimeStatus'


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

// `group` puts a section inside another section's tab strip (Billing > Unpaid bills); `tab` is the root's tab name;
// `account` sections live in the profile menu instead of the main bar (Settings).
export type ShellSection = { key: string; label: string; group?: string; tab?: string; account?: boolean }

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
  const accountMenu = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    // Close the profile menu on any click outside it or on Escape.
    const close = (event: Event) => { const menu = accountMenu.current; if (menu?.open && !(event instanceof MouseEvent && menu.contains(event.target as Node))) menu.open = false }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(event) }
    document.addEventListener('click', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', escape) }
  }, [])
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
      for (const key of ['shell-queue', 'billing-ready-count', 'queue-events', 'doctor-queue', 'doctor-alert-visit', 'visits-today', 'visits-earlier', 'doctor-discount-requests', 'doctor-earlier-count', 'doctor-today-metrics', 'clinic-alerts']) {
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
  const {data: recentEvents}=useQuery({queryKey:['queue-events',clinicId,userId],refetchInterval:queuePollInterval(connected),enabled:!!clinicId&&clinical,queryFn:async()=>{
    const {data,error}=await supabase.from('queue_events').select('id:request_id,visit_id,action,created_at,visits(token_number)').eq('clinic_id',clinicId!).neq('actor_id',userId).gte('created_at',new Date(Date.now()-60000).toISOString()).in('action',['call','sent_in','finish','request_discount']).order('created_at',{ascending:false}).limit(20)
    if(error)throw error
    const rows=data as unknown as {id:string;visit_id:string;action:string;created_at:string;visits:{token_number:number}}[]
    return { latest: rows[0] && Date.now()-Date.parse(rows[0].created_at)<10000 ? rows[0] : null, call: rows.find(event=>event.action==='call') }
  }})
  const latestEvent=recentEvents?.latest
  const latestCall=recentEvents?.call
  const { controls: soundControl, flash, enabled: chimeEnabled, permission: notificationPermission, enableNotifications } = useCallSound({ event: latestCall, tokenNumber: latestCall?.visits.token_number, userId, clinicId: clinicId ?? '', locked, available: !isDoctor && clinical })
  const [expiredEvent,setExpiredEvent]=useState<string|null>(null)
  const eventTime=latestEvent?.created_at
  const eventVisible=!!eventTime&&expiredEvent!==eventTime
  useEffect(()=>{if(!eventTime)return;const remaining=new Date(eventTime).getTime()+10000-Date.now();const timer=setTimeout(()=>setExpiredEvent(eventTime),Math.max(0,remaining));return()=>clearTimeout(timer)},[eventTime])
  const eventText=latestEvent && ({call:'Doctor called',sent_in:'Reception sent in',finish:'Ready to bill',request_discount:'Discount review requested'}[latestEvent.action])
  const current = queue?.find((visit) => ['called','with_doctor'].includes(visit.stage))
  const { data: readyToBill = 0 } = useQuery({
    queryKey: ['billing-ready-count', clinicId],
    enabled: !!clinicId && clinical && !isDoctor,
    refetchInterval: queuePollInterval(connected),
    queryFn: async () => {
      const { count, error } = await supabase.from('visits').select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId!).eq('stage', 'ready_to_bill').gte('arrived_at', new Date(`${clinicToday()}T00:00:00+05:30`).toISOString())
      if (error) throw error
      return count ?? 0
    },
  })
  // The doctor's Patients tab shows how many people look like they were registered twice (same cache as the Possible duplicates tab).
  const { data: duplicateCount = 0 } = useQuery({
    queryKey: ['possible-duplicates', clinicId], enabled: !!clinicId && isDoctor, staleTime: 5 * 60_000,
    queryFn: async () => { const { data, error } = await supabase.rpc('possible_duplicate_patients', { p_clinic_id: clinicId }); if (error) throw error; return data },
    select: (rows: unknown[]) => rows.length,
  })
  const navigation = sections.filter(section => !section.group && !section.account)
  const hubOf = (key: string) => sections.find(section => section.key === key)?.group ?? key
  const activeHub = hubOf(activeSection)
  const tabs = sections.filter(section => section.key === activeHub || section.group === activeHub)

  useEffect(() => { const label = sections.find((s) => s.key === activeSection)?.label; document.title = label ? `${label} · iClinic` : 'iClinic' }, [sections, activeSection])

  function select(key: string) { onSelectSection(key); setMenuOpen(false) }
  function navItem(section: ShellSection) {
    return <a key={section.key} href={`#${section.key}`} className="shell-nav-item"
      aria-label={section.key === 'billing' && readyToBill ? `Billing, ${readyToBill} patients waiting` : section.key === 'patients' && duplicateCount ? `Patients, ${duplicateCount} possible duplicates` : undefined}
      aria-current={section.key === activeHub ? 'page' : undefined}
      onClick={(event) => { event.preventDefault(); select(section.key) }}>{section.label}{section.key === 'billing' && readyToBill > 0 && <span className="shell-billing-count" aria-hidden="true">{readyToBill}</span>}{section.key === 'patients' && duplicateCount > 0 && <span className="shell-billing-count" aria-hidden="true">{duplicateCount}</span>}</a>
  }
  // Quiet when everything is fine: only speak up when work is waiting or at risk.
  const syncLabel = halted ? 'Save needs attention' : !online ? `Offline · ${pending.length} changes waiting` : pending.length ? `${pending.length} not saved yet` : ''
  const sync = <span className={`shell-sync ${halted || !online ? 'pending' : 'saving'}`} role="status">{syncLabel}</span>
  const waitingCount = queue?.filter((visit) => visit.stage === 'waiting').length ?? 0
  const queueLink = clinical && <a href={isDoctor ? '#consultation' : '#reception'} onClick={e => { e.preventDefault(); select(isDoctor ? 'consultation' : 'reception') }} className="shell-queue" title={online && connected ? 'Live queue' : 'Showing the saved queue; reconnecting'}>
    <span className={online && connected ? 'shell-status-dot' : 'shell-status-dot offline'} aria-hidden="true" />
    <strong>{queueError && !queue ? 'Queue unavailable' : !queue ? 'Loading…' : current ? `Seeing #${current.token_number}` : waitingCount ? `${waitingCount} waiting` : 'No one waiting'}</strong>
    {queue && current && waitingCount > 0 && <span>{waitingCount} waiting</span>}
  </a>
  const settingsSection = sections.find(section => section.account)
  const initial = (userEmail?.trim()[0] ?? '?').toUpperCase()
  const account = <details ref={accountMenu} className="shell-menu shell-account" onClick={event => { if ((event.target as HTMLElement).closest('button')) event.currentTarget.open = false }}>
    <summary className="shell-avatar" title={userEmail} aria-label="Your account">{initial}</summary>
    <div className="shell-menu-items">
      <span className="shell-user-email">{userEmail}</span>
      {clinical && <button className="shell-nav-item" onClick={() => { setMenuOpen(false); setAlertsOpen(true) }}>{!isDoctor && (!chimeEnabled || notificationPermission === 'default') ? 'Alerts and sound · off' : 'Alerts and sound'}</button>}
      {settingsSection && <button className="shell-nav-item" onClick={() => select(settingsSection.key)}>{settingsSection.label}</button>}
      <button className="shell-nav-item" onClick={() => { setMenuOpen(false); if (pinSet) onLock(); else setShowPinForm(true) }}>Lock screen</button>
      {pinSet && <button className="shell-nav-item" onClick={() => { setMenuOpen(false); setShowPinForm(true) }}>Change lock PIN</button>}
      <button className="shell-nav-item" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </div>
  </details>
  return (
    <RealtimeConnected value={connected}><div className="shell">
      {flash && <><div key={flash.id} className="call-screen-flash" aria-hidden="true" /><div className="call-screen-banner" role="alert">Doctor called{flash.tokenNumber == null ? '' : ` #${flash.tokenNumber}`} · Send patient in</div></>}
      <header ref={header} className="shell-header">
        <a className="shell-clinic-name" href={isDoctor ? '#consultation' : '#reception'} onClick={e => { e.preventDefault(); select(isDoctor ? 'consultation' : sections[0]?.key ?? '') }}>{clinicName ?? ''}</a>
        <nav className="shell-nav no-scrollbar" aria-label="Main">{navigation.map(navItem)}</nav>
        <div className="shell-status">
          {eventVisible && eventText && <span className="shell-event" role="status">{eventText} #{latestEvent?.visits.token_number}</span>}
          {queueLink}
          {sync}
          {account}
        </div>
        <button className="shell-nav-item shell-mobile-toggle" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen}>Menu ▾</button>
      </header>
      {!isDoctor && clinical && !locked && notificationPermission === 'default' && <div className="call-alert-setup" role="status">Get browser alerts when the doctor calls a patient. <button type="button" className="shell-nav-item" onClick={() => { setAlertsOpen(true); void enableNotifications() }}>Enable notifications</button></div>}
      {clinical && clinicId && <ClinicAlerts key={`${clinicId}:${userId}`} open={alertsOpen} onClose={() => setAlertsOpen(false)} onOpen={target => { if (sections.some(section => section.key === target.section)) onOpenAlert(target) }} clinicId={clinicId} userId={userId} isDoctor={isDoctor} online={online} connected={connected} locked={locked} soundControl={soundControl} />}
      <OfflineQueueBanner userId={userId} redact={locked || !clinical} />
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" placement="top">
        {queueLink}
        {sync}
        <nav className="shell-mobile-links" aria-label="Main menu">{navigation.map(navItem)}</nav>
        <div className="shell-mobile-links">
        {clinical && <button className="shell-nav-item" onClick={() => { setMenuOpen(false); setAlertsOpen(true) }}>Alerts and sound</button>}
        {settingsSection && <button className="shell-nav-item" onClick={() => select(settingsSection.key)}>{settingsSection.label}</button>}
        <button type="button" className="shell-nav-item" onClick={() => { setMenuOpen(false); if (pinSet) onLock(); else setShowPinForm(true) }}>Lock screen</button>
        {pinSet && <button type="button" className="shell-nav-item" onClick={() => { setMenuOpen(false); setShowPinForm(true) }}>Change lock PIN</button>}
        <button type="button" className="shell-nav-item" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </Drawer>
      <Drawer open={showPinForm} onClose={() => setShowPinForm(false)} title={pinSet ? 'Change lock PIN' : 'Set a lock PIN'}>
        <PinForm onDone={() => { setPinSet(true); setShowPinForm(false) }} />
      </Drawer>
      <LockScreen locked={locked} onUnlock={onUnlock} />
      <main className="shell-content">
        {activeSection ? <>{tabs.length > 1 && <nav className="shell-subnav" aria-label={sections.find(section => section.key === activeHub)?.label}>{tabs.map(tab => <a key={tab.key} href={`#${tab.key}`} className="shell-nav-item" aria-current={tab.key === activeSection ? 'page' : undefined} onClick={event => { event.preventDefault(); select(tab.key) }}>{tab.tab ?? tab.label}</a>)}</nav>}{children}</> : <p className="readout-empty">This account has no role assigned at this clinic. Contact your admin to get access.</p>}
      </main>
    </div></RealtimeConnected>
  )
}
