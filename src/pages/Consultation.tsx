import { useEffect, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { attemptOrQueue } from '../lib/offlineQueue'
import { useClinicId } from '../lib/useClinicId'
import { startOfToday, elapsedMinutes, formatElapsed } from '../lib/date'
import { PrescriptionForm } from '../components/PrescriptionForm'
import { PricingPanel } from '../components/PricingPanel'
import { DocumentsPanel } from '../components/DocumentsPanel'
import { CarePanel } from '../components/CarePanel'
import { RepQueueRows } from '../components/RepQueueRows'
import { type TodayVisit } from '../components/TodayFlow'
import { ConsultationClock } from '../components/ConsultationClock'
import { Button } from '../components/ui/button'
import { useQueueAction } from '../lib/queueActions'
import { LoadingRows, QueryError } from '../components/QueryState'
import { readPrescriptionPrint } from '../lib/prescriptionPrint'
import { Billing } from '../components/Billing'
import '../components/Worklist.css'
import './Consultation.css'
import { useQueuePollInterval } from '../lib/realtimeStatus'
import { restorePagedCache } from '../lib/pagedCache'

// A wait past this is flagged in the overdue colour (danger), not just
// shown as a plain elapsed time -- reserving colour for something that
// actually needs attention, not decoration.
const LONG_WAIT_MINUTES = 45

type DoctorVisit = {
  id: string
  token_number: number
  arrived_at: string
  complaint: string
  stage: string
  queue_position: number
  queue_note: string | null
  called_at: string | null
  sent_in_at: string | null
  not_here_at: string | null
  discount_requested_at: string | null
  patient_id: string
  with_doctor_at: string | null
  patients: { name: string; age: number | null; gender: string | null; address: string | null; phone: string | null } | null
}

type PastVisit = { id: string; arrived_at: string; complaint: string }

type PrescriptionItem = {
  medicine_id: string
  drug_type: string | null
  strength: string | null
  before_after_food: string | null
  dosage_frequency: string | null
  duration_days: number
  quantity_dispensed: number | null
  notes: string | null
  medicines: { name: string } | null
}

type Prescription = { diagnosis: string | null; advice: string | null; id: string; visit_id: string; created_at: string; prescription_items: PrescriptionItem[] }

type Comment = { id: string; body: string; created_at: string }

function formatAgeSex(age: number | null, gender: string | null): string {
  const parts = [age != null ? String(age) : null, gender ? gender.charAt(0) : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : '—'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function Consultation({ userId, onOpenPatient, requestedVisitId }: { userId: string; onOpenPatient: (id: string) => void; requestedVisitId?: string }) {
  const queryClient = useQueryClient()
  const { data: clinicId } = useClinicId(userId)
  const [visibleQueueCount, setVisibleQueueCount] = useState(7)
  const [workspace, setWorkspace] = useState<'overview' | 'prescription'>('overview')
  const [commentDrafts, setCommentDrafts] = useState<Record<string,string>>({})
  const [reviewVisitId,setReviewVisitId]=useState<string|null>(null)
  const [prescribingActive, setPrescribingActive] = useState(false)
  const [repCount, setRepCount] = useState(0)
  const [guard, setGuard] = useState(false)
  useEffect(() => { if (requestedVisitId) { if (prescribingActive && requestedVisitId !== reviewVisitId) setGuard(true); else if (!prescribingActive) setReviewVisitId(requestedVisitId) } }, [requestedVisitId, prescribingActive, reviewVisitId])
  const requested = useQuery({ queryKey: ['doctor-alert-visit', clinicId, requestedVisitId], enabled: !!clinicId && !!requestedVisitId, queryFn: async () => { const {data,error}=await supabase.from('visits').select('id, token_number, arrived_at, complaint, stage, patient_id, with_doctor_at, queue_position, queue_note, called_at, sent_in_at, not_here_at, discount_requested_at, patients(name, age, gender, address, phone)').eq('clinic_id',clinicId!).eq('id',requestedVisitId!).maybeSingle(); if(error) throw error; return data as unknown as DoctorVisit | null } })
  const queueAction = useQueueAction(clinicId)

  const interval = useQueuePollInterval()
  const today = startOfToday()
  const queueKey = ['doctor-queue', clinicId]
  const { data: visits, isPending: queueLoading, error: queueError, refetch: reloadQueue, dataUpdatedAt: queueSavedAt } = useQuery({
    queryKey: queueKey, refetchInterval:interval,
    enabled: !!clinicId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, token_number, arrived_at, complaint, stage, patient_id, with_doctor_at, queue_position, queue_note, called_at, sent_in_at, not_here_at, discount_requested_at, patients(name, age, gender, address, phone)')
        .eq('clinic_id', clinicId)
        .gte('arrived_at', today)
        .in('stage', ['waiting', 'called', 'with_doctor', 'not_here', 'ready_to_bill'])
        .order('queue_position', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return data as unknown as DoctorVisit[]
    },
  })

  const discountRequests = useInfiniteQuery({
    queryKey: ['doctor-discount-requests', clinicId, 'pages'], enabled: !!clinicId,
    refetchInterval: interval, initialPageParam: 0,
    initialData: () => restorePagedCache<DoctorVisit>(undefined, queryClient.getQueryData<DoctorVisit[]>(queueKey)?.filter(v => v.stage === 'ready_to_bill' && v.discount_requested_at)),
    getNextPageParam: (last: DoctorVisit[], pages: DoctorVisit[][]) => last.length === 50 ? pages.length * 50 : undefined,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.from('visits')
        .select('id, token_number, arrived_at, complaint, stage, patient_id, with_doctor_at, queue_position, queue_note, called_at, sent_in_at, not_here_at, discount_requested_at, patients(name, age, gender, address, phone)')
        .eq('clinic_id', clinicId!).eq('stage', 'ready_to_bill').not('discount_requested_at', 'is', null)
        .order('discount_requested_at').order('id').range(pageParam, pageParam + 49)
      if (error) throw error
      return data as unknown as DoctorVisit[]
    },
  })
  const { data: earlierCount = 0 } = useQuery({
    queryKey: ['doctor-earlier-count', clinicId, today], enabled: !!clinicId, refetchInterval: interval,
    queryFn: async () => {
      const { count, error } = await supabase.from('visits').select('id', { count: 'exact', head: true })
        .eq('clinic_id', clinicId!).lt('arrived_at', today).in('stage', ['waiting', 'called', 'with_doctor', 'not_here', 'ready_to_bill'])
      if (error) throw error
      return count ?? 0
    },
  })

  const metricsKey = ['doctor-today-metrics', clinicId]
  const { data: todayVisits } = useQuery({
    queryKey: metricsKey,
    enabled: !!clinicId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('stage, arrived_at')
        .eq('clinic_id', clinicId)
        .gte('arrived_at', startOfToday())
      if (error) throw error
      return data as TodayVisit[]
    },
  })

  const todaysQueue = visits?.filter(v => v.arrived_at >= today) ?? []
  const queue = todaysQueue.filter(v => v.stage === 'waiting')
  const active = todaysQueue.find(v => ['called','with_doctor'].includes(v.stage))
  const requests = discountRequests.data?.pages.flat() ?? []
  const current = (requested.data?.id === reviewVisitId ? requested.data : null) ?? requests.find(v=>v.id===reviewVisitId) ?? visits?.find(v=>v.id===reviewVisitId) ?? active ?? todaysQueue.filter(v => v.stage === 'ready_to_bill').sort((a,b)=>(b.sent_in_at??b.arrived_at).localeCompare(a.sent_in_at??a.arrived_at))[0]
  const rows = todaysQueue.filter(v => ['waiting','not_here'].includes(v.stage))
  const sent = current?.stage === 'ready_to_bill'
  const commentBody=current ? commentDrafts[current.patient_id]??'' : ''
  function setCommentBody(body:string) {if(current)setCommentDrafts(old=>({...old,[current.patient_id]:body}))}

  const { data: pastVisits } = useQuery({
    queryKey: ['past-visits', current?.patient_id, current?.id],
    enabled: !!current,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, arrived_at, complaint')
        .eq('patient_id', current!.patient_id)
        .neq('id', current!.id)
        .order('arrived_at', { ascending: false })
      if (error) throw error
      return data as PastVisit[]
    },
  })

  const { data: prescriptions } = useQuery({
    queryKey: ['past-prescriptions', current?.patient_id],
    enabled: !!current,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prescriptions')
        .select(
          'id, visit_id, created_at, diagnosis, advice, visits!inner(patient_id), prescription_items(medicine_id, drug_type, strength, before_after_food, dosage_frequency, duration_days, quantity_dispensed, notes, medicines(name))',
        )
        .eq('visits.patient_id', current!.patient_id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as Prescription[]
    },
  })

  const commentsKey = ['patient-comments', current?.patient_id]
  const { data: comments } = useQuery({
    queryKey: commentsKey,
    enabled: !!current,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patient_comments')
        .select('id, body, created_at')
        .eq('patient_id', current!.patient_id)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as Comment[]
    },
  })

  const {data: localPrescription}=useQuery({queryKey:['prescription-print',userId,clinicId,current?.id],enabled:!!current&&!!clinicId,queryFn:async()=>await readPrescriptionPrint(userId,clinicId!,current!.id)??null})
  const issuedMedicines = prescriptions?.filter(p => p.visit_id === current?.id).flatMap(p => p.prescription_items) ?? []
  const reviewedMedicines=localPrescription?.medicines ?? issuedMedicines
  const issuedComplete = reviewedMedicines.length > 0 && reviewedMedicines.every(item => !!item.dosage_frequency?.trim() && (item.duration_days ?? 0) > 0)

  const addComment = useMutation({
    networkMode: 'always',
    mutationFn: async ({patientId,body}: {patientId:string;body:string}) => {
      if (!clinicId) return
      const row = { id: crypto.randomUUID(), clinic_id: clinicId, patient_id: patientId, author_id: userId, body }
      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.from('patient_comments').insert(row).setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({ kind: 'insert', table: 'patient_comments', payload: row, description: 'Add a patient comment' }),
        applyOptimistic: () =>
          queryClient.setQueryData<Comment[]>(['patient-comments',patientId], (old) => [...(old ?? []), { id: row.id, body: row.body, created_at: new Date().toISOString() }]),
      })
    },
    onSuccess: (_,variables) => {
      queryClient.invalidateQueries({ queryKey: ['patient-comments',variables.patientId] })
      setCommentDrafts(old=>({...old,[variables.patientId]:old[variables.patientId]?.trim()===variables.body?'':old[variables.patientId]}))
    },
  })

  async function finish() {
    if (!current) return
    await queueAction.mutateAsync({visitId:current.id,action:'finish'})
    setWorkspace('overview')
  }
  async function callNext() {
    if (!queue[0]) return
    if (active || prescribingActive) { setGuard(true); return }
    setReviewVisitId(null)
    await queueAction.mutateAsync({visitId:queue[0].id,action:'call'})
    setWorkspace('overview'); setGuard(false)
  }

  if (!clinicId) return null

  return (
    <div className={`consultation-page ${workspace === 'prescription' && current ? 'consultation-prescribing' : ''}`}>
      {queueAction.isError && <p className="form-error" role="alert">{queueAction.error.message}</p>}
      {queueError && <QueryError retry={() => void reloadQueue()} savedAt={queueSavedAt} />}
      {queueLoading && <LoadingRows label="Loading doctor workspace…" />}
      <div className="consultation-shell">
        <aside className="consultation-rail" aria-label="Waiting patients">
          <div className="sticky-panel doctor-waiting">
          <div className="rail-head">
            <h2 className="readout-heading">Waiting · {queue.length}</h2>
            <span className="field-hint">{todayVisits?.filter(v=>['ready_to_bill','paid'].includes(v.stage)).length ?? '—'} seen today</span>
          </div>
          {guard && <div className="inline-notice" role="alert"><strong>Finish the current prescription before changing patients.</strong><p>Saved work stays with this patient.</p><Button variant="secondary" onClick={()=>{setWorkspace('prescription');setGuard(false)}}>Open prescription</Button><Button variant="ghost" onClick={()=>setGuard(false)}>Not now</Button></div>}
          {queue[0] && active?.stage !== 'called' && !guard && <Button variant="dark" disabled={queueAction.isPending} onClick={()=>void callNext().catch(()=>{})}>Call #{queue[0].token_number} {queue[0].patients?.name}</Button>}
          {rows.length === 0 && repCount === 0 && <p className="readout-empty">Your queue is empty.</p>}
          <ul className="rail-list">
            {rows.slice(0, visibleQueueCount).map(v => <li key={v.id} className={'rail-row'}>
              <span className="rail-row-token">#{v.token_number}</span>
              <span className="rail-row-name"><strong>{v.patients?.name}</strong> <span className="field-hint">{formatAgeSex(v.patients?.age??null,v.patients?.gender??null)}</span><small>{v.complaint}{v.stage==='not_here' ? ` · Not here since ${new Date(v.not_here_at!).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}` : ''}{v.queue_note && <span className="status-blue"> · {v.queue_note}</span>}</small></span>
              <span className={elapsedMinutes(v.arrived_at) >= LONG_WAIT_MINUTES ? 'rail-row-wait doctor-queue-overdue' : 'rail-row-wait'}>{formatElapsed(v.arrived_at)}</span>
            </li>)}
            {rows.length > visibleQueueCount && <li><Button variant="secondary" onClick={() => setVisibleQueueCount(count => count + 50)}>Show more</Button></li>}
            <RepQueueRows clinicId={clinicId} onCountChange={setRepCount} />
          </ul>
          {requests.filter(v=>v.discount_requested_at && v.stage==='ready_to_bill').map(v=><div className="doctor-earlier" key={v.id}><strong className="status-amber">Discount review · #{v.token_number}</strong><p>{v.patients?.name}</p><Button variant="secondary" disabled={prescribingActive} onClick={()=>{setReviewVisitId(v.id);setWorkspace('prescription')}}>Review bill</Button></div>)}
          {reviewVisitId && <Button variant="secondary" onClick={()=>{setReviewVisitId(null);setWorkspace('overview')}}>Return to consultation</Button>}
          {discountRequests.isError && <QueryError retry={() => void discountRequests.refetch()} savedAt={discountRequests.dataUpdatedAt} />}
          {discountRequests.hasNextPage && <Button variant="secondary" disabled={discountRequests.isFetchingNextPage} onClick={() => void discountRequests.fetchNextPage()}>Show more discount requests</Button>}
          {earlierCount>0 && <div className="doctor-earlier"><p className="field-hint">Left open from earlier days · {earlierCount}</p><p>Not counted in today’s queue. Reception can review them under Earlier open visits.</p></div>}
          </div>
        </aside>
        <div className="consultation-stage">
          {!current ? <div className="doctor-idle"><h2>Ready for the next patient</h2><p className="readout-empty">Call next to begin a consultation.</p></div> : <>
            {workspace === 'prescription' && <div className="rx-toolbar"><Button variant="ghost" onClick={() => setWorkspace('overview')}>← Workspace</Button><strong>Prescription · #{current.token_number} · {current.patients?.name}</strong></div>}
            <div className="doctor-overview" hidden={workspace !== 'overview'}>
              <section className="doctor-current">
                <p className={current.stage==='called' ? 'status-amber' : 'status-blue'}>{current.stage==='called' ? `Called · waiting for reception to send #${current.token_number} in` : current.sent_in_at ? `Reception sent #${current.token_number} in · ${new Date(current.sent_in_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}` : `#${current.token_number} · With doctor`}</p>
                <div className="doctor-patient-summary"><div>
                  <p className="doctor-queue-meta">#{current.token_number} · {pastVisits ? pastVisits.length ? `Follow-up · ${pastVisits.length+1} visits` : 'New patient' : 'Loading visits…'}{current.stage === 'with_doctor' && current.with_doctor_at && <ConsultationClock startedAt={current.with_doctor_at} />}</p>
                  <h2>{current.patients?.name}</h2>
                  <p>{formatAgeSex(current.patients?.age ?? null, current.patients?.gender ?? null)}{current.patients?.phone ? ` · ${current.patients.phone}` : ''}</p>
                </div>{sent ? <div className="doctor-sent"><strong className="status-green">Prescription sent to billing</strong><Button variant="secondary" onClick={()=>setWorkspace('prescription')}>View prescription</Button></div> : <Button disabled={current.stage==='called'} onClick={() => setWorkspace('prescription')}>{prescribingActive ? 'Continue prescription →' : 'Start prescription →'}</Button>}</div>
              </section>
              <div className="doctor-context">
                <section><h3>Today, from reception</h3><p>{current.complaint || 'No complaint recorded.'}</p></section>
                <section><h3>Last prescription</h3><p>{prescriptions?.find(p=>p.visit_id!==current.id)?.prescription_items.map(item => [item.medicines?.name, item.dosage_frequency, `${item.duration_days} days`].filter(Boolean).join(' ')).join(' · ') || 'No prescription on record.'}</p></section>
              </div>
              <section className="record-section"><div className="rail-head"><h3 className="readout-heading doctor-section-label">History</h3><Button variant="secondary" onClick={()=>onOpenPatient(current.patient_id)}>Full record →</Button></div>
                {!pastVisits?.length ? <p className="readout-empty">No past visits.</p> : <ul className="past-visit-list">{pastVisits.slice(0,3).map(v => <li key={v.id} className="history-row">
                  <time>{formatDate(v.arrived_at)}</time><div><p>{v.complaint}</p>{prescriptions?.filter(p => p.visit_id === v.id).map(p => <div key={p.id}>
                    {p.diagnosis && <p>{p.diagnosis}</p>}
                    <p className="field-hint">{p.prescription_items.map(item => [item.medicines?.name, item.dosage_frequency, `${item.duration_days} days`].filter(Boolean).join(' ')).join(' · ')}</p>
                    {p.advice && <p className="field-hint">{p.advice}</p>}
                  </div>)}</div>
                </li>)}</ul>}
              </section>
              <section className="record-section"><h3 className="readout-heading">Personal notes · for the doctor</h3>
                {!!comments?.length && <ul className="comment-list">{comments.map(c => <li key={c.id} className="comment-item"><span className="comment-date">{formatDate(c.created_at)}</span><p>{c.body}</p></li>)}</ul>}
                <form className="action-row" onSubmit={e => { e.preventDefault(); if (commentBody.trim()) addComment.mutate({patientId:current.patient_id,body:commentBody.trim()}) }}>
                  <div className="field comment-field"><textarea id="comment-body" aria-label="Personal note" rows={1} placeholder="Write a note about this patient" value={commentBody} onChange={e => setCommentBody(e.target.value)} /></div>
                  <Button type="submit" variant="secondary" disabled={addComment.isPending || !commentBody.trim()}>{addComment.isPending ? 'Adding…' : 'Add note'}</Button>
                </form>
                {addComment.isError && <p className="form-error">Couldn't save the note — try again.</p>}
                {current.patients?.address && <p className="field-hint">Address: {current.patients.address}</p>}
              </section>
            </div>
            <div id="stage-prescription" hidden={workspace !== 'prescription'}>
              {sent ? <Billing clinicId={clinicId} visitId={current.id} readOnly onClose={()=>setWorkspace('overview')} /> : <PrescriptionForm userId={userId} visit={current} key={current.id} clinicId={clinicId} visitId={current.id} pastPrescriptions={prescriptions} onActiveChange={setPrescribingActive}>
                <CarePanel clinicId={clinicId} key={`care-${current.id}`} visitId={current.id} patientId={current.patient_id} />
                <details className="rx-support" open><summary>Procedures &amp; bill approval</summary><PricingPanel key={current.id} clinicId={clinicId} visitId={current.id} /></details>
                <details className="rx-support"><summary>Documents</summary><DocumentsPanel key={`docs-${current.id}`} clinicId={clinicId} visitId={current.id} patientName={current.patients?.name ?? ''} patientAge={current.patients?.age ?? null} complaint={current.complaint} issuedBy={userId} /></details>
                {!prescribingActive && <div className="action-row rx-actions"><Button variant="primary" disabled={prescribingActive || queueAction.isPending || !issuedComplete} onClick={() => void finish().catch(()=>{})}>{queueAction.isPending ? 'Saving…' : 'Finish consultation'}</Button></div>}
                {prescribingActive && <p className="field-hint">Review and confirm the prescription before finishing.</p>}
                {!prescribingActive && !issuedComplete && <p className="field-hint">Finish requires a medicine, dose or SOS, and duration for every prescribed item.</p>}
                {queueAction.isError && <p className="form-error">Couldn't finish — try again.</p>}
              </PrescriptionForm>}
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}
