import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/date'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { LoadingRows } from '../components/QueryState'
import { useConfirm } from '../lib/confirm'
import './MergePatients.css'

type Candidate = { id: string; name: string; age: number | null; phone: string | null; last_visit_at: string | null }
type DuplicatePair = { a: Candidate; b: Candidate; reason: string }

// Deciding two records are the same person is a clinical judgment about a
// patient, not configuration -- this lives with the doctor, who already
// has a legitimate patients_select read, not with admin (docs/security-
// review.md's "admin cannot read patients" stays literal, no exception).
// Search reuses search_patients, the same RPC Reception's check-in screen
// calls -- SECURITY INVOKER, runs under the doctor's own RLS, no separate
// function needed for this.
function PatientSearch({ label, clinicId, selected, onSelect }: { label: string; clinicId: string; selected: Candidate | null; onSelect: (c: Candidate | null) => void }) {
  const [query, setQuery] = useState('')
  const inputId = useId()
  const { data: results } = useQuery({
    queryKey: ['merge-search', clinicId, query],
    enabled: query.trim().length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_patients', { p_clinic_id: clinicId, p_query: query.trim() })
      if (error) throw error
      return data as Candidate[]
    },
  })

  return (
    <div className="field search-results-anchor">
      <label className="field-label" htmlFor={inputId}>{label}</label>
      {selected ? (
        <div className="search-result-button merge-selected">
          <span>
            {selected.name}{' '}
            <span className="search-result-meta">
              {selected.phone ? `— ${selected.phone}` : ''} {selected.age ? `— ${selected.age}y` : ''}
              {selected.last_visit_at ? ` — last seen ${formatDate(selected.last_visit_at)}` : ' — no visits yet'}
            </span>
          </span>
          <button type="button" className="drug-row-remove" onClick={() => onSelect(null)}>
            Change
          </button>
        </div>
      ) : (
        <>
          <Input id={inputId} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or phone" />
          {query.trim() && (results?.length ?? 0) > 0 && (
            <ul className="search-results">
              {results!.map((c) => (
                <li key={c.id}>
                  <button type="button" className="search-result-button" onClick={() => onSelect(c)}>
                    {c.name}
                    <span className="search-result-meta">
                      {c.phone ? `— ${c.phone}` : ''} {c.age ? `— ${c.age}y` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() && (results?.length ?? 0) === 0 && <p className="no-match">No matching patient found.</p>}
        </>
      )}
    </div>
  )
}

export function MergePatients({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [a, setA] = useState<Candidate | null>(null)
  const [b, setB] = useState<Candidate | null>(null)
  const [result, setResult] = useState('')

  // The app finds likely duplicates by itself (same phone, or same name and age). Nothing merges until the doctor confirms a pair.
  const { data: suggestions, isPending } = useQuery({
    queryKey: ['possible-duplicates', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('possible_duplicate_patients', { p_clinic_id: clinicId })
      if (error) throw error
      return data as DuplicatePair[]
    },
  })

  const merge = useMutation({
    mutationFn: async (pair: { a: Candidate; b: Candidate }) => {
      const { data, error } = await supabase.rpc('merge_patients', { p_patient_a: pair.a.id, p_patient_b: pair.b.id })
      if (error) throw error
      return { keptId: data as string, pair }
    },
    onSuccess: ({ keptId, pair }) => {
      setResult(`Merged. The record kept is ${keptId === pair.a.id ? pair.a.name : pair.b.name}.`)
      setA(null)
      setB(null)
      queryClient.invalidateQueries({ queryKey: ['merge-search'] })
      queryClient.invalidateQueries({ queryKey: ['possible-duplicates'] })
    },
    onError: (e: Error) => setResult(e.message),
  })

  const dismiss = useMutation({
    mutationFn: async (pair: DuplicatePair) => {
      const [patient_a, patient_b] = pair.a.id < pair.b.id ? [pair.a.id, pair.b.id] : [pair.b.id, pair.a.id]
      const { error } = await supabase.from('duplicate_dismissals').insert({ clinic_id: clinicId, patient_a, patient_b })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['possible-duplicates'] }),
    // 23505: this pair was already dismissed (double click, another tab): the end state is what the doctor wanted.
    onError: (e: Error & { code?: string }) => { if (e.code === '23505') void queryClient.invalidateQueries({ queryKey: ['possible-duplicates'] }); else setResult(e.message) },
  })

  const confirmMerge = async (pair: { a: Candidate; b: Candidate }) => {
    if (await confirm({ title: 'Merge these two patients?', body: `"${pair.a.name}" and "${pair.b.name}" become one record. The older record is kept and the visits move across. This cannot be undone.`, confirmLabel: 'Merge' })) merge.mutate(pair)
  }
  const samePatient = !!a && !!b && a.id === b.id
  const detail = (c: Candidate) => [c.age ? `${c.age}y` : '', c.phone ?? '', c.last_visit_at ? `last seen ${formatDate(c.last_visit_at)}` : 'no visits yet'].filter(Boolean).join(' · ')

  return (
    <div className="merge-patients-page">
      <div className="admin-toolbar">
        <h2 className="readout-heading">Possible duplicates</h2>
      </div>
      <p className="readout-empty">Patients who share a phone number, or the same name and age, may be one person registered twice. Merging keeps the older record and moves the visits across.</p>
      {result && <p className={result.startsWith('Merged') ? 'readout-empty' : 'form-error'}>{result}</p>}
      {isPending ? <LoadingRows label="Looking for duplicates…" /> : (suggestions?.length ?? 0) === 0 ? <p className="readout-empty">No duplicates found. When someone is registered who already exists, the receptionist is shown the existing record as they type.</p> : (
        <ul className="merge-suggestion-list">
          {suggestions!.map((s) => (
            <li key={`${s.a.id}-${s.b.id}`} className="merge-suggestion">
              <div className="merge-pair">
                <span><strong>{s.a.name}</strong><small>{detail(s.a)}</small></span>
                <span><strong>{s.b.name}</strong><small>{detail(s.b)}</small></span>
              </div>
              <span className="search-result-meta">{s.reason}</span>
              <span className="merge-suggestion-actions">
                <Button type="button" variant="secondary" disabled={merge.isPending} onClick={() => void confirmMerge(s)}>Merge into one record</Button>
                <button type="button" className="merge-suggestion-dismiss" disabled={dismiss.isPending && dismiss.variables === s} onClick={async () => { if (await confirm({ title: 'Not a duplicate?', body: `${s.a.name} and ${s.b.name} will stop being suggested as the same person.`, confirmLabel: 'Different people' })) dismiss.mutate(s) }}>They are different people</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <details className="merge-manual">
        <summary>Merge two patients yourself</summary>
        <PatientSearch label="First record" clinicId={clinicId} selected={a} onSelect={setA} />
        <PatientSearch label="Second record" clinicId={clinicId} selected={b} onSelect={setB} />
        {samePatient && <p className="form-error">Pick two different patients.</p>}
        <div className="action-row">
          <Button type="button" disabled={!a || !b || samePatient || merge.isPending} onClick={() => void confirmMerge({ a: a!, b: b! })}>{merge.isPending ? 'Merging…' : 'Merge'}</Button>
        </div>
      </details>
    </div>
  )
}
