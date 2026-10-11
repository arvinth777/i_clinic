import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get, update } from 'idb-keyval'
import { supabase } from '../lib/supabase'
import { startOfToday } from '../lib/date'
import { buildClinicAlerts, reconcileAlerts, type AlertSource, type AlertTarget, type ClinicAlert, type RecentAlert } from '../lib/clinicAlerts'
import { useQueuePollInterval } from '../lib/realtimeStatus'
import { useOfflineQueue } from '../lib/useOfflineQueue'
import { drainQueue } from '../lib/offlineQueue'
import { drainUploads, listUploads, subscribeUploads, type DocumentUpload } from '../lib/documentUploads'
import { Drawer } from './Drawer'
import { LoadingRows } from './QueryState'

export function ClinicAlerts({ open, onClose, onOpen, clinicId, userId, isDoctor, online, connected, locked, soundControl }: { open: boolean; onClose: () => void; onOpen: (target: AlertTarget) => void; clinicId: string; userId: string; isDoctor: boolean; online: boolean; connected: boolean; locked: boolean; soundControl?: React.ReactNode }) {
  const client = useQueryClient()
  const { pending, halted } = useOfflineQueue()
  const [uploads, setUploads] = useState<DocumentUpload[]>([])
  const [recent, setRecent] = useState<RecentAlert[]>([])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'active' | 'recent'>('active')
  const [limit, setLimit] = useState(50)
  const [now, setNow] = useState(() => Date.now())
  const key = `clinic-alert-history:${clinicId}:${userId}`
  const interval = useQueuePollInterval()
  const today = startOfToday()
  useEffect(() => {
    let alive = true
    void get<RecentAlert[]>(key).then(value => { if (alive) { setRecent(Array.isArray(value) ? value : []); setReady(true) } }).catch(() => { if (alive) setError('Could not load recent alerts. Try reopening Alerts.') })
    const refresh = () => { void listUploads().then(items => { if (alive) setUploads(items.filter(item => item.clinicId === clinicId && item.ownerId === userId)) }).catch(() => { if (alive) setError('Could not read pending uploads.') }) }
    refresh(); const unsubscribe = subscribeUploads(refresh)
    return () => { alive = false; unsubscribe() }
  }, [key, clinicId, userId])
  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [open])
  const source = useQuery({ queryKey: ['clinic-alerts', clinicId, userId, today, isDoctor], enabled: open && !locked, refetchInterval: interval, queryFn: async () => {
    async function pages(factory: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }> }) {
      const rows: unknown[] = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await factory().range(offset, offset + 499)
        if (error) throw error
        if (!data) throw new Error('Alert source unavailable')
        rows.push(...data)
        if (data.length < 500) return rows
      }
    }
    const results = await Promise.allSettled([
      pages(() => supabase.from('visits').select('id,patient_id,token_number,stage,arrived_at,called_at,not_here_at,discount_requested_at').eq('clinic_id', clinicId).in('stage', ['waiting','called','with_doctor','not_here','ready_to_bill']).order('id')),
      pages(() => supabase.from('medicines').select('id,name,low_stock_threshold,expiry_date').eq('clinic_id', clinicId).order('id')),
      pages(() => supabase.from('medicine_stock').select('medicine_id,quantity').eq('clinic_id', clinicId).order('medicine_id').order('stock_point_id')),
      supabase.from('clinics').select('no_show_minutes').eq('id', clinicId).single(),
      isDoctor ? pages(() => supabase.from('bill_line_items').select('bill_id,shortfall,bills!inner(visit_id,confirmed_at,visits(patient_id,token_number))').eq('clinic_id', clinicId).gt('shortfall', 0).gte('bills.confirmed_at', today).order('id')) : Promise.resolve([]),
    ])
    for (const result of results) if (result.status === 'rejected') throw result.reason
    const values = results.map(result => (result as PromiseFulfilledResult<unknown>).value)
    const settings = values[3] as { data: { no_show_minutes: number }; error: unknown }
    if (settings.error) throw settings.error
    return { visits: values[0], medicines: values[1], stock: values[2], noShowMinutes: settings.data.no_show_minutes, shortfalls: values[4] } as AlertSource
  } })
  const local = useMemo(() => {
  const owned = pending.filter(item => item.ownerId === userId && item.clinicId === clinicId)
  const alerts: ClinicAlert[] = owned.map(item => ({ id: `pending:${item.id}`, title: 'Change not saved yet', detail: item.description === 'Upload patient document' ? 'A document upload is waiting on this device.' : 'A clinical or billing change is waiting on this device.', severity: 'amber', section: 'reception' }))
  if (halted?.mutation.ownerId === userId && halted.mutation.clinicId === clinicId) alerts.push({ id: `halted:${halted.mutation.id}`, title: 'Save needs attention', detail: 'Review the pending-save banner before retrying.', severity: 'red', section: 'reception' })
  if (isDoctor) for (const upload of uploads.filter(item => item.error)) alerts.push({ id: `upload:${upload.id}`, title: 'Document upload needs attention', detail: upload.error!, severity: 'red', section: 'patients', patientId: upload.metadata.patient_id, patientTab: 'documents' })
  if (!online || !connected) alerts.push({ id: 'connection', title: !online ? 'Offline' : 'Live connection interrupted', detail: !online ? 'Changes wait on this device; other screens cannot receive them yet.' : 'Queue recovery polling is active. Reconnecting…', severity: 'red', section: 'reception' })
  return alerts
  }, [pending, halted, clinicId, userId, isDoctor, uploads, online, connected])
  const active = useMemo(() => [...(source.data ? buildClinicAlerts(source.data, isDoctor, now, today) : []), ...local], [source.data, isDoctor, now, today, local])
  useEffect(() => {
    if (!open || !ready) return
    let alive = true
    void update<RecentAlert[]>(key, old => {
      const previous = Array.isArray(old) ? old : []
      const confirmed = online && !source.isFetching && !source.isError && !!source.data
      const current = confirmed ? active : [...active, ...previous.filter(item => !item.resolvedAt && !active.some(alert => alert.id === item.id) && !/^(pending:|halted:|upload:|connection$)/.test(item.id))]
      return reconcileAlerts(previous, current, new Date().toISOString())
    }).then(async () => { const value = await get<RecentAlert[]>(key); if (alive) setRecent(value ?? []) }).catch(() => { if (alive) setError('Recent alerts could not be saved on this device.') })
    return () => { alive = false }
  // Only confirmed source/local changes reconcile history; failed reads never clear it.
  }, [source.dataUpdatedAt, source.isError, open, ready, online, connected, now, pending, halted, uploads, key, source.data, source.isFetching, active])
  async function mark(id: string, dismissed = false) {
    try {
      await update<RecentAlert[]>(key, old => (old ?? []).map(item => item.id === id ? { ...item, read: true, dismissed } : item))
      setRecent(await get<RecentAlert[]>(key) ?? [])
    } catch { setError('Could not save this alert change on the device.') }
  }
  async function navigate(alert: ClinicAlert) {
    setError('')
    if (!online) { setError('Reconnect before opening an alert so its current state can be checked. Saved screens remain available from the menu.'); return }
    const result = await source.refetch()
    if (result.isError) { setError('Could not verify the latest state. Try again.'); return }
    let target: AlertTarget = alert
    if (alert.visitId) {
      const {data,error}=await supabase.from('visits').select('id,stage,patient_id').eq('clinic_id',clinicId).eq('id',alert.visitId).maybeSingle()
      if(error || !data) { setError('This visit is no longer available. Refresh alerts.'); return }
      target={...alert,patientId:data.patient_id}
      if(alert.section==='consultation' && !['called','with_doctor','ready_to_bill'].includes(data.stage)) target={...target,section:'patients'}
      if(alert.section==='billing' && !['paid','ready_to_bill'].includes(data.stage)) target={...target,section:'reception'}
    }
    await mark(alert.id)
    onClose(); onOpen(target)
  }
  const visibleActive = active.filter(alert => !recent.find(item => item.id === alert.id)?.dismissed)
  const visible = tab === 'active' ? visibleActive : recent
  return <Drawer open={open && !locked} onClose={onClose} title="Alerts">
    {soundControl}
    <p className="field-hint">{source.dataUpdatedAt ? `Last checked · ${new Date(source.dataUpdatedAt).toLocaleTimeString('en-IN', {timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit'})} IST` : 'Awaiting first check'}</p>
    <p className="field-hint">Remind after 5 minutes · Closing review at 4:00 PM IST</p>
    <p className="field-hint">Recent/read/dismiss state is saved for this account on this device.</p>
    <div className="queue-filters"><button className="shell-nav-item" aria-pressed={tab === 'active'} onClick={() => { setTab('active'); setLimit(50) }}>Active · {visibleActive.length}</button><button className="shell-nav-item" aria-pressed={tab === 'recent'} onClick={() => { setTab('recent'); setLimit(50) }}>Recent · {recent.filter(item => !item.read).length} unread</button></div>
    {(error || source.isError) && <p role="alert" className="form-error">{error || 'Could not refresh alerts. Showing the last saved copy; issues have not been marked resolved.'}</p>}
    <button className="shell-nav-item" onClick={() => { void drainQueue(); void drainUploads(true); void client.invalidateQueries({ queryKey: ['clinic-alerts', clinicId] }); setError('') }}>Retry saves and refresh</button>
    {source.isPending && <LoadingRows label="Checking clinic alerts…" />}
    {visible.slice(0, limit).map(alert => <article className="clinic-alert-row" key={alert.id}>
      <strong className={`status-${alert.severity}`}>{alert.title}</strong><p>{alert.detail}</p>
      {'resolvedAt' in alert && typeof alert.resolvedAt === 'string' && alert.resolvedAt && <p className="field-hint">Resolved · {new Date(alert.resolvedAt).toLocaleString('en-IN', {timeZone:'Asia/Kolkata'})}</p>}
      <button className="shell-nav-item" onClick={() => void navigate(alert)}>Open</button>
      <button className="shell-nav-item" onClick={() => void mark(alert.id, true)}>Dismiss</button>
    </article>)}
    {!source.isPending && !visible.length && <p className="readout-empty">No alerts in this view.</p>}
    {visible.length > limit && <button className="shell-nav-item" onClick={() => setLimit(value => value + 50)}>Show more</button>}
  </Drawer>
}
