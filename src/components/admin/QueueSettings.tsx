import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { attemptOrQueue } from '../../lib/offlineQueue'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { LoadingRows, QueryError } from '../QueryState'

export function QueueSettings({ clinicId }: { clinicId: string }) {
  const client = useQueryClient(), key = ['queue-settings', clinicId]
  const [absenceDraft, setAbsenceDraft] = useState<string>()
  const [calledDraft, setCalledDraft] = useState<string>()
  const [closeDraft, setCloseDraft] = useState<string>()
  const query = useQuery({ queryKey: key, queryFn: async () => {
    const { data, error } = await supabase.from('clinics').select('no_show_minutes,called_reminder_minutes,closing_minute').eq('id', clinicId).single()
    if (error) throw error
    return data
  } })
  const closing = query.data?.closing_minute ?? 960
  const closeValue = closeDraft ?? `${String(Math.floor(closing / 60)).padStart(2, '0')}:${String(closing % 60).padStart(2, '0')}`
  const save = useMutation({ networkMode: 'always', mutationFn: async (fields: FormData) => {
    const absence = Number(fields.get('no_show_minutes'))
    const called = Number(fields.get('called_reminder_minutes'))
    const close = String(fields.get('closing_time') ?? '')
    if (![absence, called].every(value => Number.isInteger(value) && value >= 1 && value <= 240)) throw new Error('Use a whole number from 1 to 240 minutes for each reminder.')
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(close)) throw new Error('Choose a valid clinic closing time.')
    const [hour, minute] = close.split(':').map(Number)
    const args = { p_clinic_id: clinicId, p_no_show_minutes: absence, p_called_reminder_minutes: called, p_closing_minute: hour * 60 + minute }
    await attemptOrQueue({ clinicId, attempt: token => supabase.rpc('set_alert_settings', args).setHeader('Authorization', `Bearer ${token}`), queueItem: () => ({ kind: 'rpc', rpc: 'set_alert_settings', payload: args, description: 'Change clinic reminder settings' }), applyOptimistic: () => client.setQueryData(key, { no_show_minutes: absence, called_reminder_minutes: called, closing_minute: args.p_closing_minute }) })
  }, onSuccess: () => {
    void client.invalidateQueries({ queryKey: key }); void client.invalidateQueries({ queryKey: ['clinic-alerts', clinicId] })
    setAbsenceDraft(undefined); setCalledDraft(undefined); setCloseDraft(undefined)
  } })
  return <section><h2>Queue and alert settings</h2><p className="field-hint">Clinic time is IST. Reminders never remove patients or settle bills automatically.</p>
    {query.isError && <QueryError retry={() => void query.refetch()} savedAt={query.dataUpdatedAt} />}
    {query.isPending ? <LoadingRows label="Loading settings…" /> : query.data && <form onSubmit={event => { event.preventDefault(); save.mutate(new FormData(event.currentTarget)) }}>
      <div className="field"><label className="field-label" htmlFor="no-show-minutes">No-show reminder (minutes)</label><Input id="no-show-minutes" name="no_show_minutes" type="number" min={1} max={240} step={1} required value={absenceDraft ?? query.data.no_show_minutes} onChange={event => setAbsenceDraft(event.target.value)} /></div>
      <div className="field"><label className="field-label" htmlFor="called-reminder-minutes">Called but not sent in (minutes)</label><Input id="called-reminder-minutes" name="called_reminder_minutes" type="number" min={1} max={240} step={1} required value={calledDraft ?? query.data.called_reminder_minutes} onChange={event => setCalledDraft(event.target.value)} /></div>
      <div className="field"><label className="field-label" htmlFor="clinic-closing-time">Closing time (IST)</label><Input id="clinic-closing-time" name="closing_time" type="time" required value={closeValue} onChange={event => setCloseDraft(event.target.value)} /></div>
      <Button disabled={save.isPending} type="submit">Save</Button>
    </form>}
    {save.isError && <p role="alert" className="form-error">{save.error.message}</p>}
  </section>
}
