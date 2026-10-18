import { useEffect, useRef, useState } from 'react'
import { StatusPill } from '../components/StatusPill'
import { Icon } from '../components/Icon'
import { DoctorHome } from '../components/DoctorHome'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { DoctorOverview } from '../components/DoctorOverview'
import { Button } from '../components/ui/button'
import { useQueueAction, CANCEL_VISIT_DIALOG } from '../lib/queueActions'
import { useAskReason } from '../lib/confirm'
import { LoadingRows, QueryError } from '../components/QueryState'
import { readPrescriptionPrint } from '../lib/prescriptionPrint'
import { Billing } from '../components/Billing'
import { IssuedPrescription } from '../components/IssuedPrescription'
import '../components/Worklist.css'
import './Consultation.css'
import { useQueuePollInterval } from '../lib/realtimeStatus'
import { useVisitProcedures } from '../lib/useVisitProcedures'

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
  patients: { name: string; age: number | null; gender: string | null; address: string | null; phone: string | null; height_cm: number | null; weight_kg: number | null; custom_fields: Record<string, unknown> | null; is_long_term: boolean | null } | null
}

type PastVisit = { id: string; arrived_at: string; complaint: string; follow_up_date: string | null }

type PrescriptionItem = {
  medicine_id: string
  molecule_name: string | null
  stock_unit: string | null
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

export function Consultation({ userId, onOpenPatient, onNavigate, requestedVisitId, alertNavigation = 0 }: { userId: string; onOpenPatient: (id: string) => void; onNavigate: (section: string) => void; requestedVisitId?: string; alertNavigation?: number }) {
  const queryClient = useQueryClient()
  const { data: clinicId } = useClinicId(userId)
  const [visibleQueueCount, setVisibleQueueCount] = useState(7)
  type Workspace = 'overview' | 'prescription' | 'billing'
  const workspaceFromUrl = (): Workspace => {
    const view = window.location.hash.split('/')[1]
    return view === 'prescription' || view === 'billing' ? view : 'overview'
  }
  const [workspace, setWorkspaceState] = useState<Workspace>(workspaceFromUrl)
  useEffect(() => {
    const restore = () => setWorkspaceState(workspaceFromUrl())
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])
  function setWorkspace(next: Workspace) {
    if (typeof window === 'undefined') { setWorkspaceState(next); return }
    const target = next === 'overview' ? '#consultation' : `#consultation/${next}`
    if (window.location.hash !== target) window.history.pushState({ clinicWorkspace: true }, '', target)
    setWorkspaceState(next)
  }
  function backToWorkspace() {
    if (typeof window === 'undefined') { setWorkspaceState('overview'); return }
    if (window.history.state?.clinicWorkspace && workspace !== 'overview') window.history.back()
    else {
      window.history.replaceState(null, '', '#consultation')
      setWorkspaceState('overview')
    }
  }
  const [commentDrafts, setCommentDrafts] = useState<Record<string,string>>({})
  const [reviewVisitId,setReviewVisitId]=useState<string|null>(null)
  const [prescribingActive, setPrescribingActive] = useState(false)
  const [repCount, setRepCount] = useState(0)
  const [guard, setGuard] = useState(false)
  const handledAlert = useRef(-1)
  useEffect(() => {
    if (!requestedVisitId || handledAlert.current === alertNavigation) return
    handledAlert.current = alertNavigation
    if (prescribingActive && requestedVisitId !== reviewVisitId) setGuard(true)
    else if (!prescribingActive) setReviewVisitId(requestedVisitId)
  }, [alertNavigation, requestedVisitId, prescribingActive, reviewVisitId])
  const requested = useQuery({ queryKey: ['doctor-alert-visit', clinicId, requestedVisitId], refetchInterval: useQueuePollInterval(), enabled: !!clinicId && !!requestedVisitId, queryFn: async () => { const {data,error}=await supabase.from('visits').select('id, token_number, arrived_at, complaint, stage, patient_id, with_doctor_at, queue_position, queue_note, called_at, sent_in_at, not_here_at, discount_requested_at, patients(name, age, gender, address, phone, height_cm, weight_kg, custom_fields, is_long_term)').eq('clinic_id',clinicId!).eq('id',requestedVisitId!).maybeSingle(); if(error) throw error; return data as unknown as DoctorVisit | null } })
  const queueAction = useQueueAction(clinicId)
  const askReason = useAskReason()

  const interval = useQueuePollInterval()
  const today = startOfToday()
  const queueKey = ['doctor-queue', clinicId]
  const { data: visits, isPending: queueLoading, error: queueError, refetch: reloadQueue, dataUpdatedAt: queueSavedAt } = useQuery({
    queryKey: queueKey, refetchInterval:interval,
    enabled: !!clinicId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, token_number, arrived_at, complaint, stage, patient_id, with_doctor_at, queue_position, queue_note, called_at, sent_in_at, not_here_at, discount_requested_at, patients(name, age, gender, address, phone, height_cm, weight_kg, custom_fields, is_long_term)')
        .eq('clinic_id', clinicId)
        .gte('arrived_at', today)
        .in('stage', ['waiting', 'called', 'with_doctor', 'not_here', 'ready_to_bill'])
        .order('queue_position', { ascending: true })
        .order('id', { ascending: true })
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
  const current = (requested.data?.id === reviewVisitId ? requested.data : null) ?? visits?.find(v=>v.id===reviewVisitId) ?? active ?? todaysQueue.filter(v => v.stage === 'ready_to_bill').sort((a,b)=>(b.sent_in_at??b.arrived_at).localeCompare(a.sent_in_at??a.arrived_at))[0]
  const rows = todaysQueue.filter(v => ['waiting','not_here'].includes(v.stage))
  const sent = current?.stage === 'ready_to_bill' || current?.stage === 'paid'
  const commentBody=current ? commentDrafts[current.patient_id]??'' : ''
  function setCommentBody(body:string) {if(current)setCommentDrafts(old=>({...old,[current.patient_id]:body}))}

  const { data: pastVisits } = useQuery({
    queryKey: ['past-visits', current?.patient_id, current?.id],
    enabled: !!current,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, arrived_at, complaint, follow_up_date')
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
          'id, visit_id, created_at, diagnosis, advice, visits!inner(patient_id), prescription_items(medicine_id, molecule_name, stock_unit, drug_type, strength, before_after_food, dosage_frequency, duration_days, quantity_dispensed, notes, medicines(name))',
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
  const { data: visitProcedures } = useVisitProcedures(current?.id)
  // A visit can finish on medicines or on procedures alone (injection, dressing); every medicine it does have needs a dose and days.
  const hasWork = reviewedMedicines.length > 0 || (visitProcedures?.length ?? 0) > 0
  const medicinesComplete = reviewedMedicines.every(item => !!item.dosage_frequency?.trim() && (item.duration_days ?? 0) > 0)
  const issuedComplete = hasWork && medicinesComplete
  const finishProblem = !hasWork ? 'Add a medicine or a procedure before finishing.' : !medicinesComplete ? 'Every medicine needs a dose (or SOS) and a number of days.' : ''
  const [triedFinish, setTriedFinish] = useState(false)

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
    <div className={`consultation-page ${workspace !== 'overview' && current ? 'consultation-prescribing' : ''}`}>
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
              <span className="rail-row-wait"><StatusPill tone={v.stage === 'not_here' ? 'mute' : elapsedMinutes(v.arrived_at) >= LONG_WAIT_MINUTES ? 'warn' : 'info'}>{formatElapsed(v.arrived_at)}</StatusPill></span>
            </li>)}
            {rows.length > visibleQueueCount && <li><Button variant="secondary" onClick={() => setVisibleQueueCount(count => count + 50)}>Show more</Button></li>}
            <RepQueueRows clinicId={clinicId} onCountChange={setRepCount} />
          </ul>
          {reviewVisitId && <Button variant="secondary" onClick={()=>{setReviewVisitId(null);setWorkspace('overview')}}>Return to consultation</Button>}
          {earlierCount>0 && <div className="doctor-earlier"><p className="field-hint">Still open from earlier days · {earlierCount}</p><p>Not counted in today’s queue. Reception can close them under Earlier days.</p></div>}
          </div>
        </aside>
        <div className="consultation-stage">
          {!current ? <DoctorHome clinicId={clinicId} onNavigate={onNavigate} /> : <>
            {workspace !== 'overview' && <div className="rx-toolbar"><Button variant="ghost" onClick={backToWorkspace}>← Back to workspace</Button><strong>{workspace === 'billing' ? 'Bill review' : 'Prescription'} · #{current.token_number} · {current.patients?.name}</strong></div>}
            <div className="doctor-overview" hidden={workspace !== 'overview'}>
              <DoctorOverview clinicId={clinicId} visit={current} pastVisits={pastVisits} prescriptions={prescriptions} comments={comments}
                noteDraft={commentBody} onNoteDraft={setCommentBody} onAddNote={() => addComment.mutate({ patientId: current.patient_id, body: commentBody.trim() })} noteBusy={addComment.isPending} noteFailed={addComment.isError} noteSaved={addComment.isSuccess}
                sent={sent} prescribingActive={prescribingActive} busy={queueAction.isPending}
                onStart={() => setWorkspace('prescription')} onViewPrescription={() => setWorkspace('prescription')} onOpenRecord={() => onOpenPatient(current.patient_id)}
                onCancel={() => void askReason({ ...CANCEL_VISIT_DIALOG, body: `#${current.token_number} ${current.patients?.name ?? ''}. ${CANCEL_VISIT_DIALOG.body}` }).then(why => { if (why) queueAction.mutate({ visitId: current.id, action: 'cancel', reason: why }) })} />
            </div>
            <div id="stage-prescription" hidden={workspace === 'overview'}>
              {sent && workspace === 'billing' ? <Billing clinicId={clinicId} visitId={current.id} readOnly onClose={()=>setWorkspace('overview')} /> : sent ? <IssuedPrescription key={current.id} userId={userId} clinicId={clinicId} visitId={current.id} /> : <PrescriptionForm userId={userId} visit={current} key={current.id} clinicId={clinicId} visitId={current.id} pastPrescriptions={prescriptions} onActiveChange={setPrescribingActive}>
                <CarePanel clinicId={clinicId} key={`care-${current.id}`} visitId={current.id} patientId={current.patient_id} />
                <details className="rx-support" open><summary>Procedures &amp; consultation charge</summary><PricingPanel key={current.id} clinicId={clinicId} visitId={current.id} /></details>
                <details className="rx-support"><summary>Documents</summary><DocumentsPanel key={`docs-${current.id}`} clinicId={clinicId} visitId={current.id} patientName={current.patients?.name ?? ''} patientAge={current.patients?.age ?? null} complaint={current.complaint} issuedBy={userId} /></details>
                {!prescribingActive && <div className="action-row rx-actions"><Button variant="success" disabled={prescribingActive || queueAction.isPending} onClick={() => { if (issuedComplete) void finish().catch(()=>{}); else { setTriedFinish(true); requestAnimationFrame(() => document.getElementById('finish-problem')?.scrollIntoView({ block: 'center', behavior: 'smooth' })) } }}>{queueAction.isPending ? 'Saving…' : <><Icon name="check" />Finish consultation</>}</Button></div>}
                {prescribingActive && <p className="field-hint">Review and confirm the prescription before finishing.</p>}
                {!prescribingActive && !issuedComplete && <p id="finish-problem" className={triedFinish ? 'form-error' : 'field-hint'} role={triedFinish ? 'alert' : undefined}>{finishProblem}</p>}
              </PrescriptionForm>}
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}
