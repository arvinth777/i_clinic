import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { supabase } from '../lib/supabase'
import { useClinicId } from '../lib/useClinicId'
import { PrescriptionForm } from '../components/PrescriptionForm'
import './Consultation.css'

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

function formatElapsed(arrivedAt: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(arrivedAt).getTime()) / 60000))
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

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

  useEffect(() => {
    if (!clinicId) return
    const channel = supabase
      .channel(`doctor-queue-${clinicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visits', filter: `clinic_id=eq.${clinicId}` },
        () => queryClient.invalidateQueries({ queryKey: queueKey }),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId])

  const queue = visits?.filter((v) => v.stage === 'waiting') ?? []
  const current = visits?.find((v) => v.stage === 'with_doctor')

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queueKey }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queueKey }),
  })

  if (!clinicId) return null

  return (
    <div className="consultation-grid">
      <div>
        <h2 className="readout-heading">Queue</h2>
        {queue.length === 0 ? (
          <p className="readout-empty">Your queue is empty.</p>
        ) : (
          <>
            <div className="action-row">
              <motion.button
                type="button"
                className="primary-button"
                whileTap={{ scale: 0.97 }}
                disabled={!!current || callNext.isPending}
                onClick={() => callNext.mutate(queue[0].id)}
              >
                {callNext.isPending ? 'Calling…' : 'Call next'}
              </motion.button>
            </div>
            <div className="readout-list">
              {queue.map((v) => (
                <div key={v.id} className="doctor-queue-row">
                  <span className="readout-token">{v.token_number}</span>
                  <span className="readout-name">{v.patients?.name}</span>
                  <span className="doctor-queue-meta">{formatAgeSex(v.patients?.age ?? null, v.patients?.gender ?? null)}</span>
                  <span className="doctor-queue-complaint">{v.complaint}</span>
                  <span className="doctor-queue-meta">{formatElapsed(v.arrived_at)}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {callNext.isError && <p className="form-error">Couldn't save — try again.</p>}
      </div>

      <div className="record-panel">
        {!current ? (
          <p className="readout-empty">Call the next patient to open their record.</p>
        ) : (
          <>
            <h2 className="form-heading">
              {current.patients?.name} <span className="doctor-queue-meta">Token {current.token_number}</span>
            </h2>

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
              <h3 className="readout-heading">Demographics</h3>
              <p>
                {formatAgeSex(current.patients?.age ?? null, current.patients?.gender ?? null)}
                {current.patients?.address ? ` · ${current.patients.address}` : ''}
                {current.patients?.phone ? ` · ${current.patients.phone}` : ''}
              </p>
            </section>

            <section className="record-section">
              <h3 className="readout-heading">Today's complaint</h3>
              <p>{current.complaint}</p>
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

            {!prescribingActive && (
              <div className="action-row">
                <motion.button
                  type="button"
                  className="primary-button"
                  whileTap={{ scale: 0.97 }}
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
      </div>
    </div>
  )
}
