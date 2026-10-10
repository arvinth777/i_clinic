import { useEffect, useState } from 'react'
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
import { TodayFlow, type TodayVisit } from '../components/TodayFlow'
import { ConsultationClock } from '../components/ConsultationClock'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import '../components/Worklist.css'
import './Consultation.css'

// A wait past this is flagged in the overdue colour (danger), not just
// shown as a plain elapsed time -- reserving colour for something that
// actually needs attention, not decoration.
const LONG_WAIT_MINUTES = 30

type DoctorVisit = {
  id: string
  token_number: number
  arrived_at: string
  complaint: string
  stage: string
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

export function Consultation({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const { data: clinicId } = useClinicId(userId)
  const [workspace, setWorkspace] = useState<'overview' | 'prescription'>('overview')
  const [commentBody, setCommentBody] = useState('')
  const [prescribingActive, setPrescribingActive] = useState(false)
  const [repCount, setRepCount] = useState(0)

  const queueKey = ['doctor-queue', clinicId]
  const { data: visits } = useQuery({
    queryKey: queueKey,
    enabled: !!clinicId,
    // Inherits queryClient's 3s default (was a 30s override here) --
    // no reason for this one query to poll slower than everything else.
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, token_number, arrived_at, complaint, stage, patient_id, with_doctor_at, patients(name, age, gender, address, phone)')
        .eq('clinic_id', clinicId)
        .in('stage', ['waiting', 'with_doctor'])
        .order('arrived_at', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return data as unknown as DoctorVisit[]
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

  useEffect(() => {
    if (!clinicId) return
    const channel = supabase
      .channel(`doctor-queue-${clinicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visits', filter: `clinic_id=eq.${clinicId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: queueKey })
          queryClient.invalidateQueries({ queryKey: metricsKey })
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId])

  const queue = visits?.filter((v) => v.stage === 'waiting') ?? []
  const current = visits?.find((v) => v.stage === 'with_doctor')
  // Already token_number ascending from the query -- strict arrival order,
  // never re-sortable here (the rail is a queue readout, not a worklist the
  // doctor picks through; only "Call next" advances it).
  const rows = visits ?? []

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

  function patchVisit(visitId: string, patch: Partial<DoctorVisit>) {
    queryClient.setQueryData<DoctorVisit[]>(queueKey, (old) => old?.map((v) => (v.id === visitId ? { ...v, ...patch } : v)))
  }

  const callNext = useMutation({
    networkMode: 'always',
    mutationFn: async (visitId: string) => {
      // with_doctor_at is purely for the consultation-duration clock/data
      // reference (Phase UI-4) -- distinct from arrived_at (wait time).
      // Stamped here, in the same update that flips the stage, since
      // that's the one real moment this transition happens.
      const withDoctorAt = new Date().toISOString()
      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.from('visits').update({ stage: 'with_doctor', with_doctor_at: withDoctorAt }).eq('id', visitId).eq('stage', 'waiting').setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({
          kind: 'update',
          table: 'visits',
          payload: { stage: 'with_doctor', with_doctor_at: withDoctorAt },
          match: { id: visitId },
          description: 'Call next patient',
        }),
        applyOptimistic: () => patchVisit(visitId, { stage: 'with_doctor', with_doctor_at: withDoctorAt }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queueKey })
      queryClient.invalidateQueries({ queryKey: metricsKey })
    },
  })

  const addComment = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      if (!current || !clinicId) return
      const row = { id: crypto.randomUUID(), clinic_id: clinicId, patient_id: current.patient_id, author_id: userId, body: commentBody.trim() }
      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.from('patient_comments').insert(row).setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({ kind: 'insert', table: 'patient_comments', payload: row, description: 'Add a patient comment' }),
        applyOptimistic: () =>
          queryClient.setQueryData<Comment[]>(commentsKey, (old) => [...(old ?? []), { id: row.id, body: row.body, created_at: new Date().toISOString() }]),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentsKey })
      setCommentBody('')
    },
  })

  const consultationDone = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      if (!current) return
      const consultationEndedAt = new Date().toISOString()
      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.from('visits').update({ stage: 'packing', consultation_ended_at: consultationEndedAt }).eq('id', current.id).setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({
          kind: 'update',
          table: 'visits',
          payload: { stage: 'packing', consultation_ended_at: consultationEndedAt },
          match: { id: current.id },
          description: `Finish consultation for ${current.patients?.name ?? 'a patient'}`,
        }),
        applyOptimistic: () => patchVisit(current.id, { stage: 'packing' }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queueKey })
      queryClient.invalidateQueries({ queryKey: metricsKey })
    },
  })

  if (!clinicId) return null

  return (
    <div className={`consultation-page ${workspace === 'prescription' && current ? 'consultation-prescribing' : ''}`}>
      {callNext.isError && <p className="form-error">Couldn't call the next patient — try again.</p>}
      <div className="consultation-shell">
        <aside className="consultation-rail" aria-label="Waiting patients">
          <TodayFlow visits={todayVisits} />
          <div className="rail-head">
            <h2 className="readout-heading">Waiting · {queue.length}</h2>
            <Button disabled={queue.length === 0 || !!current || callNext.isPending} onClick={() => callNext.mutate(queue[0].id)}>
              {callNext.isPending ? 'Calling…' : 'Call next'}
            </Button>
          </div>
          {rows.length === 0 && repCount === 0 && <p className="readout-empty">Your queue is empty.</p>}
          <ul className="rail-list">
            {rows.map(v => <li key={v.id} className={v.stage === 'with_doctor' ? 'rail-row rail-row-active' : 'rail-row'}>
              <span className="rail-row-token">#{v.token_number}</span>
              <span className="rail-row-name">{v.patients?.name}<small>{v.stage === 'with_doctor' ? 'With doctor' : v.complaint}</small></span>
              <span className={elapsedMinutes(v.arrived_at) >= LONG_WAIT_MINUTES ? 'rail-row-wait doctor-queue-overdue' : 'rail-row-wait'}>{formatElapsed(v.arrived_at)}</span>
            </li>)}
            <RepQueueRows clinicId={clinicId} onCountChange={setRepCount} />
          </ul>
        </aside>
        <div className="consultation-stage">
          {!current ? <div className="doctor-idle"><h2>Ready for the next patient</h2><p className="readout-empty">Call next to begin a consultation.</p></div> : <>
            {workspace === 'prescription' && <div className="rx-toolbar"><Button variant="ghost" onClick={() => setWorkspace('overview')}>← Workspace</Button><strong>Prescription · #{current.token_number} · {current.patients?.name}</strong></div>}
            <div className="doctor-overview" hidden={workspace !== 'overview'}>
              <p className="doctor-queue-meta">#{current.token_number} · With doctor</p>
              <div className="stage-head"><h2>{current.patients?.name}</h2>{current.with_doctor_at && <ConsultationClock startedAt={current.with_doctor_at} />}</div>
              <div className="doctor-patient-summary"><p>{formatAgeSex(current.patients?.age ?? null, current.patients?.gender ?? null)}{current.patients?.phone ? ` · ${current.patients.phone}` : ''}</p><Button onClick={() => setWorkspace('prescription')}>{prescribingActive ? 'Continue prescription →' : 'Start prescription →'}</Button></div>
              <div className="doctor-context">
                <section><h3>Today, from reception</h3><p>{current.complaint || 'No complaint recorded.'}</p></section>
                <section><h3>Last prescription</h3><p>{prescriptions?.[0]?.prescription_items.map(item => [item.medicines?.name, item.dosage_frequency].filter(Boolean).join(' ')).join(' · ') || 'No prescription on record.'}</p></section>
              </div>
              <section className="record-section"><h3 className="readout-heading">History</h3>
                {!pastVisits?.length ? <p className="readout-empty">No past visits.</p> : <ul className="past-visit-list">{pastVisits.map(v => <li key={v.id} className="history-row">
                  <time>{formatDate(v.arrived_at)}</time><div><p>{v.complaint}</p>{prescriptions?.filter(p => p.visit_id === v.id).map(p => <div key={p.id}>
                    {p.diagnosis && <p>{p.diagnosis}</p>}
                    <p className="field-hint">{p.prescription_items.map(item => [item.medicines?.name, item.dosage_frequency, `${item.duration_days} days`].filter(Boolean).join(' ')).join(' · ')}</p>
                    {p.advice && <p className="field-hint">{p.advice}</p>}
                  </div>)}</div>
                </li>)}</ul>}
              </section>
              <section className="record-section"><h3 className="readout-heading">Personal notes</h3>
                {!!comments?.length && <ul className="comment-list">{comments.map(c => <li key={c.id} className="comment-item"><span className="comment-date">{formatDate(c.created_at)}</span><p>{c.body}</p></li>)}</ul>}
                <form className="action-row" onSubmit={e => { e.preventDefault(); if (commentBody.trim()) addComment.mutate() }}>
                  <div className="field comment-field"><label className="field-label" htmlFor="comment-body">Something worth remembering next time</label><Input id="comment-body" value={commentBody} onChange={e => setCommentBody(e.target.value)} /></div>
                  <Button type="submit" variant="secondary" disabled={addComment.isPending || !commentBody.trim()}>{addComment.isPending ? 'Adding…' : 'Add note'}</Button>
                </form>
                {addComment.isError && <p className="form-error">Couldn't save the note — try again.</p>}
                {current.patients?.address && <p className="field-hint">Address: {current.patients.address}</p>}
              </section>
            </div>
            <div id="stage-prescription" hidden={workspace !== 'prescription'}>
              <PrescriptionForm userId={userId} visit={current} key={current.id} clinicId={clinicId} visitId={current.id} pastPrescriptions={prescriptions} onActiveChange={setPrescribingActive}>
                <CarePanel clinicId={clinicId} key={`care-${current.id}`} visitId={current.id} patientId={current.patient_id} />
                <details className="rx-support"><summary>Procedures &amp; bill approval</summary><PricingPanel key={current.id} clinicId={clinicId} visitId={current.id} /></details>
                <details className="rx-support"><summary>Documents</summary><DocumentsPanel key={`docs-${current.id}`} clinicId={clinicId} visitId={current.id} patientName={current.patients?.name ?? ''} patientAge={current.patients?.age ?? null} complaint={current.complaint} issuedBy={userId} /></details>
                <div className="action-row rx-actions"><Button disabled={prescribingActive || consultationDone.isPending || !prescriptions?.some(p => p.visit_id === current.id && p.prescription_items.length > 0)} onClick={() => consultationDone.mutate()}>{consultationDone.isPending ? 'Saving…' : 'Finish consultation'}</Button></div>
                {prescribingActive && <p className="field-hint">Review and confirm the prescription before finishing.</p>}
                {consultationDone.isError && <p className="form-error">Couldn't finish — try again.</p>}
              </PrescriptionForm>
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}
