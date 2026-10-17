import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/date'
import { useConfirm } from '../lib/confirm'
import { Button } from './ui/button'
import { Input } from './ui/input'
import './DuplicateNotice.css'

type Candidate = { id: string; name: string; age: number | null; phone: string | null; last_visit_at: string | null }
type Pair = { a: Candidate; b: Candidate; reason: string }
const detail = (c: Candidate) => [c.age ? `${c.age}y` : '', c.phone ?? '', c.last_visit_at ? `last seen ${formatDate(c.last_visit_at)}` : 'no visits'].filter(Boolean).join(' · ')

// Shown inside one patient's file (doctor only). The app finds likely duplicates by itself (same phone, or same name and age)
// and raises only the ones that involve THIS patient; nothing merges until the doctor confirms. The older record is always kept.
export function DuplicateNotice({ clinicId, patientId, onMerged }: { clinicId: string; patientId: string; onMerged: (keptId: string) => void }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [message, setMessage] = useState('')
  const { data: pairs } = useQuery({
    queryKey: ['possible-duplicates', clinicId], staleTime: 5 * 60_000,
    queryFn: async () => { const { data, error } = await supabase.rpc('possible_duplicate_patients', { p_clinic_id: clinicId }); if (error) throw error; return data as Pair[] },
  })
  const mine = (pairs ?? []).filter(p => p.a.id === patientId || p.b.id === patientId)
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['possible-duplicates', clinicId] }); void queryClient.invalidateQueries({ queryKey: ['patient-directory', clinicId] }) }
  const merge = useMutation({
    mutationFn: async (other: Candidate) => { const { data, error } = await supabase.rpc('merge_patients', { p_patient_a: patientId, p_patient_b: other.id }); if (error) throw error; return data as string },
    onSuccess: keptId => { setMessage('Merged into one record.'); refresh(); onMerged(keptId) },
    onError: (e: Error) => setMessage(e.message),
  })
  const dismiss = useMutation({
    mutationFn: async (pair: Pair) => { const [patient_a, patient_b] = pair.a.id < pair.b.id ? [pair.a.id, pair.b.id] : [pair.b.id, pair.a.id]; const { error } = await supabase.from('duplicate_dismissals').insert({ clinic_id: clinicId, patient_a, patient_b }); if (error) throw error },
    onSuccess: refresh,
    // 23505: already dismissed (double click, another tab): the end state is what the doctor wanted.
    onError: (e: Error & { code?: string }) => { if (e.code === '23505') refresh(); else setMessage(e.message) },
  })
  const ask = async (other: Candidate) => { if (await confirm({ title: 'Merge these two records?', body: `"${other.name}" and this patient become one record. The older record is kept and the visits move across. This cannot be undone.`, confirmLabel: 'Merge' })) merge.mutate(other) }

  return (
    <>
      {mine.map(pair => {
        const other = pair.a.id === patientId ? pair.b : pair.a
        return (
          <div key={`${pair.a.id}-${pair.b.id}`} className="dup-notice" role="status">
            <p><strong>May be the same person as {other.name}</strong> <span>({detail(other)}). {pair.reason}.</span></p>
            <span className="dup-actions">
              <Button type="button" variant="secondary" disabled={merge.isPending} onClick={() => void ask(other)}>Merge into one record</Button>
              <button type="button" className="dup-link" disabled={dismiss.isPending} onClick={() => dismiss.mutate(pair)}>Not the same person</button>
            </span>
          </div>
        )
      })}
      {message && <p className={message.startsWith('Merged') ? 'field-hint' : 'form-error'}>{message}</p>}
      <ManualMerge clinicId={clinicId} onPick={ask} excludeId={patientId} />
    </>
  )
}

// For the rare duplicate the app did not spot: find the other record by name or phone.
function ManualMerge({ clinicId, excludeId, onPick }: { clinicId: string; excludeId: string; onPick: (other: Candidate) => void }) {
  const [query, setQuery] = useState('')
  const id = useId()
  const { data } = useQuery({
    queryKey: ['merge-search', clinicId, query], enabled: query.trim().length > 1,
    queryFn: async () => { const { data, error } = await supabase.rpc('search_patients', { p_clinic_id: clinicId, p_query: query.trim() }); if (error) throw error; return data as Candidate[] },
  })
  return (
    <details className="dup-manual">
      <summary>Registered twice? Merge with another record</summary>
      <label className="field-label" htmlFor={id}>Find the other record</label>
      <Input id={id} value={query} onChange={e => setQuery(e.target.value)} placeholder="Name or phone" />
      <ul className="dup-results">{(data ?? []).filter(c => c.id !== excludeId).slice(0, 5).map(c => <li key={c.id}><span>{c.name}<small> {detail(c)}</small></span><Button type="button" variant="secondary" onClick={() => onPick(c)}>Merge</Button></li>)}</ul>
    </details>
  )
}
