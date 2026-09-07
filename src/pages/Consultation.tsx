import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
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
import { SectionStepper, type StepperSection } from '../components/SectionStepper'
import { ConsultationClock } from '../components/ConsultationClock'
import { Button, buttonVariants } from '../components/ui/button'
import { Input } from '../components/ui/input'
import '../components/Worklist.css'
import './Consultation.css'

// A wait past this is flagged in the overdue colour (danger), not just
// shown as a plain elapsed time -- reserving colour for something that
// actually needs attention, not decoration.
const LONG_WAIT_MINUTES = 30

// Jump-nav only (confirmed explicitly, not a gated wizard) -- every id
// here must match a real section id rendered below.
const STAGE_SECTIONS: StepperSection[] = [
  { id: 'stage-overview', label: 'Overview' },
  { id: 'stage-prescription', label: 'Prescription' },
  { id: 'stage-procedures', label: 'Procedures & pricing' },
  { id: 'stage-documents', label: 'Documents & follow-up' },
]

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

type Prescription = { id: string; created_at: string; prescription_items: PrescriptionItem[] }

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
        .order('token_number', { ascending: true })
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
          'id, created_at, visits!inner(patient_id), prescription_items(medicine_id, drug_type, strength, before_after_food, dosage_frequency, duration_days, quantity_dispensed, notes, medicines(name))',
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
        attempt: () => supabase.from('visits').update({ stage: 'with_doctor', with_doctor_at: withDoctorAt }).eq('id', visitId).eq('stage', 'waiting'),
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
        attempt: () => supabase.from('patient_comments').insert(row),
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
        attempt: () => supabase.from('visits').update({ stage: 'packing', consultation_ended_at: consultationEndedAt }).eq('id', current.id),
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
    <div className="consultation-page">
      <TodayFlow visits={todayVisits} />
      {callNext.isError && <p className="form-error">Couldn't save — try again.</p>}

      <div className="consultation-shell">
        <div className="consultation-rail">
          <div className="rail-head">
            <h2 className="readout-heading">Queue</h2>
            <Button
              type="button"
              disabled={queue.length === 0 || !!current || callNext.isPending}
              onClick={() => callNext.mutate(queue[0].id)}
            >
              {callNext.isPending ? 'Calling…' : 'Call next'}
            </Button>
          </div>

          {(!visits || visits.length === 0) && repCount === 0 ? (
            <p className="readout-empty">Your queue is empty.</p>
          ) : (
            <ul className="rail-list">
              {rows.map((v) => {
                const overdue = elapsedMinutes(v.arrived_at) >= LONG_WAIT_MINUTES
                const isCurrent = v.stage === 'with_doctor'
                return (
                  <li key={v.id} className={isCurrent ? 'rail-row rail-row-active' : 'rail-row'}>
                    <span className="rail-row-token">{v.token_number}</span>
                    <span className="rail-row-name">{v.patients?.name}</span>
                    <span className={overdue ? 'rail-row-wait doctor-queue-overdue' : 'rail-row-wait'}>{formatElapsed(v.arrived_at)}</span>
                  </li>
                )
              })}
              <RepQueueRows clinicId={clinicId} onCountChange={setRepCount} />
            </ul>
          )}
        </div>

        <div className="consultation-stage">
          {!current ? (
            <p className="readout-empty">Call next to begin a consultation.</p>
          ) : (
            <>
              <div className="stage-head">
                <h2>{current.patients?.name}</h2>
                <span className="doctor-queue-meta">Token {current.token_number}</span>
                {/* Only set going forward -- a visit already with_doctor
                    before this phase's migration has no with_doctor_at
                    to compute from, so the clock just doesn't render
                    rather than show a bogus/negative duration. */}
                {current.with_doctor_at && <ConsultationClock startedAt={current.with_doctor_at} />}
              </div>

              <SectionStepper sections={STAGE_SECTIONS} />

              <div id="stage-overview">
              <section className="record-section">
                <h3 className="readout-heading">Comments</h3>
              {!comments || comments.length === 0 ? (
                <p className="readout-empty">No comments yet.</p>
              ) : (
                <ul className="comment-list">
                  {comments.map((c) => (
                    <li key={c.id} className="comment-item">
                      <span className="comment-date">{formatDate(c.created_at)}</span>
                      <p>{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="action-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (commentBody.trim()) addComment.mutate()
                }}
              >
                <div className="field comment-field">
                  <label className="field-label" htmlFor="comment-body">
                    Add a comment
                  </label>
                  <Input
                    id="comment-body"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder="Something worth remembering next time"
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={addComment.isPending || !commentBody.trim()}>
                  {addComment.isPending ? 'Adding…' : 'Add'}
                </Button>
              </form>
              {addComment.isError && <p className="form-error">Couldn't save — try again.</p>}
            </section>

            <section className="record-section">
              <h3 className="readout-heading">Patient</h3>
              <dl className="field-list">
                <div className="field-row">
                  <dt>Age / sex</dt>
                  <dd>{formatAgeSex(current.patients?.age ?? null, current.patients?.gender ?? null)}</dd>
                </div>
                {(current.patients?.address || current.patients?.phone) && (
                  <div className="field-row">
                    <dt>Contact</dt>
                    <dd>{[current.patients?.address, current.patients?.phone].filter(Boolean).join(' · ')}</dd>
                  </div>
                )}
                <div className="field-row">
                  <dt>Complaint</dt>
                  <dd>{current.complaint}</dd>
                </div>
              </dl>
            </section>

            <section className="record-section">
              <h3 className="readout-heading">Past visits</h3>
              {!pastVisits || pastVisits.length === 0 ? (
                <p className="readout-empty">No past visits.</p>
              ) : (
                <ul className="past-visit-list">
                  {pastVisits.map((v) => (
                    <li key={v.id} className="past-visit-item">
                      <span className="comment-date">{formatDate(v.arrived_at)}</span>
                      <p>{v.complaint}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="record-section">
              <h3 className="readout-heading">Past prescriptions</h3>
              {!prescriptions || prescriptions.length === 0 ? (
                <p className="readout-empty">No prescriptions on record yet.</p>
              ) : (
                <ul className="past-visit-list">
                  {prescriptions.map((p) => (
                    <li key={p.id} className="past-visit-item">
                      <span className="comment-date">{formatDate(p.created_at)}</span>
                      <p>
                        {p.prescription_items
                          .map((item) => [item.medicines?.name, item.dosage_frequency].filter(Boolean).join(' — '))
                          .join(', ')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
              </div>

              <div id="stage-prescription">
            <section className="record-section">
              <h3 className="readout-heading">Write prescription</h3>
              <PrescriptionForm
                key={current.id}
                clinicId={clinicId}
                visitId={current.id}
                pastPrescriptions={prescriptions}
                onActiveChange={setPrescribingActive}
              />
            </section>
              </div>

              <div id="stage-procedures">
            <PricingPanel key={current.id} clinicId={clinicId} visitId={current.id} />
              </div>

              <div id="stage-documents">
            <CarePanel key={`care-${current.id}`} visitId={current.id} patientId={current.patient_id} />

            <DocumentsPanel
              key={`docs-${current.id}`}
              clinicId={clinicId}
              visitId={current.id}
              patientName={current.patients?.name ?? ''}
              patientAge={current.patients?.age ?? null}
              complaint={current.complaint}
              issuedBy={userId}
            />

            {!prescribingActive && (
              <div className="action-row">
                <motion.button
                  type="button"
                  className={buttonVariants({ variant: 'primary' })}
                  whileTap={{ scale: 0.96, rotate: -1 }}
                  disabled={consultationDone.isPending}
                  onClick={() => consultationDone.mutate()}
                >
                  {consultationDone.isPending ? 'Saving…' : 'Consultation done'}
                </motion.button>
              </div>
            )}
              {consultationDone.isError && <p className="form-error">Couldn't save — try again.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
