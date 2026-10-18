import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { attemptOrQueue } from '../lib/offlineQueue'
import { supabase } from '../lib/supabase'
import './CarePanel.css'
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

  // Both settings save as soon as they change; "Saved" confirms it.
  const saveLongTerm = useMutation({
    mutationFn: async ({ on, days }: { on: boolean; days: number }) => {
      const { error } = await supabase.rpc('set_patient_long_term', { p_patient_id: patientId, p_is_long_term: on, p_review_interval_days: on ? days : null })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: longTermKey }),
  })
  const setRegular = (on: boolean, days: string) => {
    setIsLongTerm(on); setIntervalDays(days)
    const n = Number(days)
    if (!on || (Number.isInteger(n) && n > 0 && n <= 3650)) saveLongTerm.mutate({ on, days: n })
  }

  const saveFollowUp = useMutation({
    networkMode: 'always',
    mutationFn: async (date: string) => {
      const payload = { p_visit_id: visitId, p_follow_up_date: date || null }
      await attemptOrQueue({ clinicId,
        attempt: token => supabase.rpc('set_visit_follow_up', payload).setHeader('Authorization', `Bearer ${token}`),
        queueItem: () => ({ kind: 'rpc', rpc: 'set_visit_follow_up', payload, description: 'Save review date' }),
        applyOptimistic: () => queryClient.setQueryData(followUpKey, { follow_up_date: payload.p_follow_up_date }),
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: followUpKey }),
  })
  const setFollowUp = (date: string) => { setFollowUpDate(date); saveFollowUp.mutate(date) }
  const saved = (m: { isPending: boolean; isSuccess: boolean; isError: boolean }) => m.isPending ? <span className="care-state">Saving…</span> : m.isError ? <span className="care-state care-state-error" role="alert">Not saved, try again</span> : m.isSuccess ? <span className="care-state care-state-ok" role="status">✓ Saved</span> : null

  return (
    <section className="record-section care-panel">
      <h3 className="readout-heading">Next visit</h3>

      <div className="care-row">
        <div className="care-row-head"><label className="care-label" htmlFor="follow-up-date">Come back on</label>{saved(saveFollowUp)}</div>
        <p className="care-help">Printed on the prescription as the review date.</p>
        <div className="care-controls">
          <Input id="follow-up-date" type="date" min={today} max={maxDay} value={followUpDate} onChange={(e) => setFollowUp(e.target.value)} />
          <div className="rx-quick-add" role="group" aria-label="Quick follow-up dates">
            {([[7, '1 week'], [14, '2 weeks'], [30, '1 month'], [90, '3 months']] as const).map(([days, label]) => {
              const date = addDays(today, days)
              return date <= maxDay && <button key={days} type="button" className="rx-chip" aria-pressed={followUpDate === date} onClick={() => setFollowUp(date)}>{label}</button>
            })}
          </div>
        </div>
      </div>

      <div className="care-row">
        <div className="care-row-head">
          <label className="care-label care-check" htmlFor="long-term-checkbox"><input id="long-term-checkbox" type="checkbox" checked={isLongTerm} onChange={(e) => setRegular(e.target.checked, e.target.checked ? intervalDays || '30' : intervalDays)} /> Keep calling this patient back</label>
          {saved(saveLongTerm)}
        </div>
        <p className="care-help">For ongoing treatment. They show under <strong>Due for review</strong> once this many days pass after their last visit.</p>
        {isLongTerm && (
          <div className="care-controls">
            <div className="care-every"><label htmlFor="long-term-interval">Every</label><Input id="long-term-interval" type="number" min={1} max={3650} value={intervalDays} onChange={(e) => setRegular(true, e.target.value)} /><span>days</span></div>
            <div className="rx-quick-add" role="group" aria-label="Common intervals">
              {[15, 30, 60, 90].map(days => <button key={days} type="button" className="rx-chip" aria-pressed={intervalDays === String(days)} onClick={() => setRegular(true, String(days))}>{days} days</button>)}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
