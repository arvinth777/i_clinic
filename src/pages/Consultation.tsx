import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { supabase } from '../lib/supabase'
import { useClinicId } from '../lib/useClinicId'
import { startOfToday, elapsedMinutes, formatElapsed } from '../lib/date'
import { nextSortState, sortRows, type SortState } from '../lib/sort'
import { PrescriptionForm } from '../components/PrescriptionForm'
import { PricingPanel } from '../components/PricingPanel'
import { Drawer } from '../components/Drawer'
import '../components/Worklist.css'
import './Consultation.css'

// A wait past this is flagged in the overdue colour (danger), not just
// shown as a plain elapsed time -- reserving colour for something that
// actually needs attention, not decoration.
const LONG_WAIT_MINUTES = 30

type TodayVisit = { stage: string; arrived_at: string }

type DoctorVisit = {
  id: string
  token_number: number
  arrived_at: string
  complaint: string
  stage: string
  patient_id: string
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
  notes: string | null
  medicines: { name: string } | null
}

type Prescription = { id: string; created_at: string; prescription_items: PrescriptionItem[] }

type Comment = { id: string; body: string; created_at: string }

// Today's flow: three real numbers off the clinic's own visits (nothing
// fabricated) plus one proportional bar in the same stage colours used
// everywhere else in the app -- waiting/with-doctor/seen-today, not the
// full five-stage taxonomy, since only these three matter from the
// doctor's own desk. A slim strip above the worklist, not a boxed card --
// nothing here needs its own visual region separate from the table below.
function TodayFlow({ visits }: { visits: TodayVisit[] | undefined }) {
  const waiting = visits?.filter((v) => v.stage === 'waiting').length ?? 0
  const withDoctor = visits?.filter((v) => v.stage === 'with_doctor').length ?? 0
  const seenToday = visits?.filter((v) => v.stage !== 'waiting' && v.stage !== 'with_doctor').length ?? 0
  const total = waiting + withDoctor + seenToday

  const waitingMinutes = (visits ?? []).filter((v) => v.stage === 'waiting').map((v) => elapsedMinutes(v.arrived_at))
  const avgWait = waitingMinutes.length ? Math.round(waitingMinutes.reduce((sum, m) => sum + m, 0) / waitingMinutes.length) : null
  const overdue = avgWait !== null && avgWait >= LONG_WAIT_MINUTES

  return (
    <div className="flow-widget">
      <div className="flow-stats">
        <div className="flow-stat">
          <span className="flow-stat-value">{waiting}</span>
          <span className="flow-stat-label">Waiting</span>
        </div>
        <div className="flow-stat">
          <span className="flow-stat-value">{seenToday}</span>
          <span className="flow-stat-label">Seen today</span>
        </div>
        <div className="flow-stat">
          <span className={overdue ? 'flow-stat-value flow-overdue' : 'flow-stat-value'}>{avgWait !== null ? `${avgWait}m` : '—'}</span>
          <span className="flow-stat-label">Avg wait now</span>
        </div>
      </div>
      {total > 0 && (
        <div className="flow-bar" role="img" aria-label={`${waiting} waiting, ${withDoctor} with the doctor, ${seenToday} seen today`}>
          {waiting > 0 && <span className="flow-bar-segment flow-bar-waiting" style={{ flexGrow: waiting }} />}
          {withDoctor > 0 && <span className="flow-bar-segment flow-bar-with-doctor" style={{ flexGrow: withDoctor }} />}
          {seenToday > 0 && <span className="flow-bar-segment flow-bar-seen" style={{ flexGrow: seenToday }} />}
        </div>
      )}
    </div>
  )
}

function formatAgeSex(age: number | null, gender: string | null): string {
  const parts = [age != null ? String(age) : null, gender ? gender.charAt(0) : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : '—'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const STAGE_LABEL: Record<string, string> = { waiting: 'Waiting', with_doctor: 'With doctor' }

type SortKey = 'token' | 'name' | 'wait'

function sortValue(v: DoctorVisit, key: SortKey): string | number {
  switch (key) {
    case 'token':
      return v.token_number
    case 'name':
      return v.patients?.name ?? ''
    case 'wait':
      return elapsedMinutes(v.arrived_at)
  }
}

function SortHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: SortState<SortKey>; onSort: (k: SortKey) => void }) {
  const active = sort?.key === sortKey
  return (
    <th>
      <button type="button" className="worklist-sort" onClick={() => onSort(sortKey)}>
        {label}
        <span className="worklist-sort-arrow">{active ? (sort!.direction === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  )
}

export function Consultation({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const { data: clinicId } = useClinicId(userId)
  const [commentBody, setCommentBody] = useState('')
  const [prescribingActive, setPrescribingActive] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sort, setSort] = useState<SortState<SortKey>>(null)

  const queueKey = ['doctor-queue', clinicId]
  const { data: visits } = useQuery({
    queryKey: queueKey,
    enabled: !!clinicId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, token_number, arrived_at, complaint, stage, patient_id, patients(name, age, gender, address, phone)')
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
  const rows = sortRows(visits ?? [], sort, sortValue)

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
          'id, created_at, visits!inner(patient_id), prescription_items(medicine_id, drug_type, strength, before_after_food, dosage_frequency, duration_days, notes, medicines(name))',
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

  const callNext = useMutation({
    mutationFn: async (visitId: string) => {
      const { error } = await supabase.from('visits').update({ stage: 'with_doctor' }).eq('id', visitId).eq('stage', 'waiting')
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queueKey })
      queryClient.invalidateQueries({ queryKey: metricsKey })
      setDrawerOpen(true)
    },
  })

  const addComment = useMutation({
    mutationFn: async () => {
      if (!current || !clinicId) return
      const { error } = await supabase
        .from('patient_comments')
        .insert({ clinic_id: clinicId, patient_id: current.patient_id, author_id: userId, body: commentBody.trim() })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: commentsKey })
      setCommentBody('')
    },
  })

  const consultationDone = useMutation({
    mutationFn: async () => {
      if (!current) return
      const { error } = await supabase.from('visits').update({ stage: 'packing' }).eq('id', current.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queueKey })
      queryClient.invalidateQueries({ queryKey: metricsKey })
      setDrawerOpen(false)
    },
  })

  if (!clinicId) return null

  return (
    <div className="consultation-page">
      <TodayFlow visits={todayVisits} />

      <div className="consultation-toolbar">
        <h2 className="readout-heading">Queue</h2>
        <motion.button
          type="button"
          className="primary-button"
          whileTap={{ scale: 0.97 }}
          disabled={queue.length === 0 || !!current || callNext.isPending}
          onClick={() => callNext.mutate(queue[0].id)}
        >
          {callNext.isPending ? 'Calling…' : 'Call next'}
        </motion.button>
      </div>
      {callNext.isError && <p className="form-error">Couldn't save — try again.</p>}

      {!visits || visits.length === 0 ? (
        <p className="readout-empty">Your queue is empty.</p>
      ) : (
        <div className="worklist-scroll">
          <table className="worklist">
            <thead>
              <tr>
                <SortHeader label="Token" sortKey="token" sort={sort} onSort={(k) => setSort(nextSortState(sort, k))} />
                <SortHeader label="Name" sortKey="name" sort={sort} onSort={(k) => setSort(nextSortState(sort, k))} />
                <th>Age · sex</th>
                <th>Complaint</th>
                <SortHeader label="Wait" sortKey="wait" sort={sort} onSort={(k) => setSort(nextSortState(sort, k))} />
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const overdue = elapsedMinutes(v.arrived_at) >= LONG_WAIT_MINUTES
                const isCurrent = v.stage === 'with_doctor'
                return (
                  <tr
                    key={v.id}
                    className={isCurrent ? 'worklist-row worklist-row-clickable' : 'worklist-row'}
                    onClick={isCurrent ? () => setDrawerOpen(true) : undefined}
                    role={isCurrent ? 'button' : undefined}
                    tabIndex={isCurrent ? 0 : undefined}
                  >
                    <td>
                      <span className="readout-token">{v.token_number}</span>
                    </td>
                    <td className="worklist-name-cell">{v.patients?.name}</td>
                    <td className="worklist-wait-cell">{formatAgeSex(v.patients?.age ?? null, v.patients?.gender ?? null)}</td>
                    <td className="worklist-complaint-cell">{v.complaint}</td>
                    <td className={overdue ? 'worklist-wait-cell doctor-queue-overdue' : 'worklist-wait-cell'}>{formatElapsed(v.arrived_at)}</td>
                    <td>
                      <span className="stage-pill">{STAGE_LABEL[v.stage] ?? v.stage}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Drawer
        open={drawerOpen && !!current}
        onClose={() => setDrawerOpen(false)}
        title={current ? <>{current.patients?.name} <span className="doctor-queue-meta">Token {current.token_number}</span></> : ''}
      >
        {current && (
          <>
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
                  <input
                    id="comment-body"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    placeholder="Something worth remembering next time"
                  />
                </div>
                <motion.button
                  type="submit"
                  className="secondary-button"
                  whileTap={{ scale: 0.97 }}
                  disabled={addComment.isPending || !commentBody.trim()}
                >
                  {addComment.isPending ? 'Adding…' : 'Add'}
                </motion.button>
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

            <section className="record-section">
              <h3 className="readout-heading">Write prescription</h3>
              <PrescriptionForm
                key={current.id}
                clinicId={clinicId}
                visitId={current.id}
                lastPrescriptionItems={prescriptions?.[0]?.prescription_items}
                onActiveChange={setPrescribingActive}
              />
            </section>

            <PricingPanel key={current.id} clinicId={clinicId} visitId={current.id} />

            {!prescribingActive && (
              <div className="action-row">
                <motion.button
                  type="button"
                  className="primary-button"
                  whileTap={{ scale: 0.96, rotate: -1 }}
                  disabled={consultationDone.isPending}
                  onClick={() => consultationDone.mutate()}
                >
                  {consultationDone.isPending ? 'Saving…' : 'Consultation done'}
                </motion.button>
              </div>
            )}
            {consultationDone.isError && <p className="form-error">Couldn't save — try again.</p>}
          </>
        )}
      </Drawer>
    </div>
  )
}
