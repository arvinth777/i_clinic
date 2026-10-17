import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { attemptOrQueue } from '../lib/offlineQueue'
import { supabase } from '../lib/supabase'
import { Button } from './ui/button'
import { Input } from './ui/input'

type PatientLongTerm = { is_long_term: boolean; long_term_review_interval_days: number | null }
type VisitFollowUp = { follow_up_date: string | null }

// YYYY-MM-DD plus n days, calendar arithmetic only (no time zones involved).
const addDays = (iso: string, days: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }

export function CarePanel({ visitId, patientId, clinicId }: { visitId: string; patientId: string; clinicId: string }) {
  const queryClient = useQueryClient()
  // Review date: today (clinic time) up to 5 years ahead, same window the database enforces.
  const [{ today, maxDay }] = useState(() => {
    const day = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    return { today: day(Date.now()), maxDay: day(Date.now() + 1825 * 864e5) }
  })

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
    networkMode: 'always',
    mutationFn: async () => {
      const payload = { p_visit_id: visitId, p_follow_up_date: followUpDate || null }
      await attemptOrQueue({ clinicId,
        attempt: token => supabase.rpc('set_visit_follow_up', payload).setHeader('Authorization', `Bearer ${token}`),
        queueItem: () => ({ kind: 'rpc', rpc: 'set_visit_follow_up', payload, description: 'Save review date' }),
        applyOptimistic: () => queryClient.setQueryData(followUpKey, { follow_up_date: payload.p_follow_up_date }),
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: followUpKey }),
  })

  return (
    <section className="record-section care-panel">
      <h3 className="readout-heading">Review</h3>

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
        <Input id="follow-up-date" type="date" min={today} max={maxDay} value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} />
        <div className="rx-quick-add" role="group" aria-label="Quick follow-up dates">
          {([[7, '1 week'], [14, '2 weeks'], [30, '1 month'], [90, '3 months']] as const).map(([days, label]) => {
            const date = addDays(today, days)
            return date <= maxDay && <button key={days} type="button" className="rx-chip" aria-pressed={followUpDate === date} onClick={() => setFollowUpDate(date)}>{label}</button>
          })}
        </div>
        <div className="action-row">
          <Button type="submit" variant="secondary" disabled={saveFollowUp.isPending}>
            {saveFollowUp.isPending ? 'Saving…' : 'Save follow-up date'}
          </Button>
        </div>
        {saveFollowUp.isError && <p className="form-error">Couldn't save — try again.</p>}
      </form>

      <details className="rx-support"><summary>Regular check-ups</summary><form
        className="field"
        onSubmit={(e) => {
          e.preventDefault()
          saveLongTerm.mutate()
        }}
      >
        <label className="field-label" htmlFor="long-term-checkbox">
          <input id="long-term-checkbox" type="checkbox" checked={isLongTerm} onChange={(e) => setIsLongTerm(e.target.checked)} /> This patient needs regular check-ups
        </label>
        {isLongTerm && (
          <>
            <label className="field-label" htmlFor="long-term-interval">
              Ask them to come back every (days)
            </label>
            <Input id="long-term-interval" type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} required />
          </>
        )}
        <div className="action-row">
          <Button type="submit" variant="secondary" disabled={saveLongTerm.isPending || (isLongTerm && !intervalDays)}>
            {saveLongTerm.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {saveLongTerm.isError && <p className="form-error">Couldn't save — try again.</p>}
      </form></details>
    </section>
  )
}
