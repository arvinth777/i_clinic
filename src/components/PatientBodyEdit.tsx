import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { attemptOrQueue } from '../lib/offlineQueue'
import { supabase } from '../lib/supabase'
import { bodyOk, HEIGHT_RANGE, WEIGHT_RANGE } from '../lib/patientBody'
import { Button } from './ui/button'
import { Input } from './ui/input'

// Returning patients: height and weight change over time, and there is no other patient edit screen.
export function PatientBodyEdit({ clinicId, patientId, height, weight }: { clinicId: string; patientId: string; height: number | null; weight: number | null }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [h, setH] = useState('')
  const [w, setW] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!open) return <Button variant="ghost" onClick={() => { setH(height != null ? String(Number(height)) : ''); setW(weight != null ? String(Number(weight)) : ''); setError(''); setOpen(true) }}>Update height and weight</Button>
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!bodyOk(h, ...HEIGHT_RANGE)) return setError('Height must be 30 to 260 cm.')
    if (!bodyOk(w, ...WEIGHT_RANGE)) return setError('Weight must be 1 to 400 kg.')
    const payload = { height_cm: h.trim() ? Number(h) : null, weight_kg: w.trim() ? Number(w) : null }
    setBusy(true); setError('')
    try {
      const { queued } = await attemptOrQueue({
        clinicId,
        attempt: token => supabase.from('patients').update(payload).eq('id', patientId).setHeader('Authorization', `Bearer ${token}`),
        queueItem: () => ({ kind: 'update', table: 'patients', match: { id: patientId }, payload, description: 'Save height and weight' }),
        applyOptimistic: () => client.setQueryData(['patient-body', patientId], payload),
      })
      if (!queued) await client.invalidateQueries({ queryKey: ['patient-body', patientId] })
      setOpen(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Try again.') } finally { setBusy(false) }
  }
  return <form className="patient-body-edit" onSubmit={save}>
    <label className="field"><span className="field-label">Height (cm)</span><Input type="number" inputMode="decimal" min={HEIGHT_RANGE[0]} max={HEIGHT_RANGE[1]} step={0.1} value={h} onChange={e => setH(e.target.value)} /></label>
    <label className="field"><span className="field-label">Weight (kg)</span><Input type="number" inputMode="decimal" min={WEIGHT_RANGE[0]} max={WEIGHT_RANGE[1]} step={0.1} value={w} onChange={e => setW(e.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="action-row"><Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
  </form>
}
