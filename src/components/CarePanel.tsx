import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

type PatientLongTerm = { is_long_term: boolean; long_term_review_interval_days: number | null }
type VisitFollowUp = { follow_up_date: string | null }

export function CarePanel({ visitId, patientId }: { visitId: string; patientId: string }) {
  const queryClient = useQueryClient()

  const longTermKey = ['patient-long-term', patientId]
  const { data: longTerm } = useQuery({
    queryKey: longTermKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('patients').select('is_long_term, long_term_review_interval_days').eq('id', patientId).single()
      if (error) throw error
      return data as PatientLongTerm
    },
  })

  const followUpKey = ['visit-follow-up', visitId]
  const { data: followUp } = useQuery({
    queryKey: followUpKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('visits').select('follow_up_date').eq('id', visitId).single()
      if (error) throw error
      return data as VisitFollowUp
    },
  })

  const [isLongTerm, setIsLongTerm] = useState(false)
  const [intervalDays, setIntervalDays] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')

  useEffect(() => {
    setIsLongTerm(longTerm?.is_long_term ?? false)
    setIntervalDays(longTerm?.long_term_review_interval_days ? String(longTerm.long_term_review_interval_days) : '')
  }, [longTerm?.is_long_term, longTerm?.long_term_review_interval_days])

  useEffect(() => {
    setFollowUpDate(followUp?.follow_up_date ?? '')
  }, [followUp?.follow_up_date])

  const saveLongTerm = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('set_patient_long_term', {
        p_patient_id: patientId,
        p_is_long_term: isLongTerm,
        p_review_interval_days: isLongTerm ? Number(intervalDays) : null,
      })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: longTermKey }),
  })

  const saveFollowUp = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('set_visit_follow_up', { p_visit_id: visitId, p_follow_up_date: followUpDate || null })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: followUpKey }),
  })

  return (
    <section className="record-section">
      <h3 className="readout-heading">Follow-up &amp; long-term care</h3>

      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault()
          saveFollowUp.mutate()
        }}
      >
        <label className="field-label" htmlFor="follow-up-date">
          Follow-up date
        </label>
        <input id="follow-up-date" type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
        <div className="action-row">
          <button type="submit" className="secondary-button" disabled={saveFollowUp.isPending}>
            {saveFollowUp.isPending ? 'Saving…' : 'Save follow-up date'}
          </button>
        </div>
        {saveFollowUp.isError && <p className="form-error">Couldn't save — try again.</p>}
      </form>

      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault()
          saveLongTerm.mutate()
        }}
      >
        <label className="field-label" htmlFor="long-term-checkbox">
          <input id="long-term-checkbox" type="checkbox" checked={isLongTerm} onChange={(e) => setIsLongTerm(e.target.checked)} /> Long-term patient
        </label>
        {isLongTerm && (
          <>
            <label className="field-label" htmlFor="long-term-interval">
              Review interval (days)
            </label>
            <input id="long-term-interval" type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} required />
          </>
        )}
        <div className="action-row">
          <button type="submit" className="secondary-button" disabled={saveLongTerm.isPending || (isLongTerm && !intervalDays)}>
            {saveLongTerm.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
        {saveLongTerm.isError && <p className="form-error">Couldn't save — try again.</p>}
      </form>
    </section>
  )
}
