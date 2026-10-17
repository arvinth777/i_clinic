import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/date'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { useConfirm } from '../lib/confirm'
import './MergePatients.css'

type Candidate = { id: string; name: string; age: number | null; phone: string | null; last_visit_at: string | null }
type DuplicatePair = { a: Candidate; b: Candidate; reason: string }

const brief = (c: Candidate) => [c.name, c.age ? `${c.age}y` : '', c.phone ?? ''].filter(Boolean).join(' · ')

// Deciding two records are the same person is a clinical judgment about a
// patient, not configuration -- this lives with the doctor, who already
// has a legitimate patients_select read, not with admin (docs/security-
// review.md's "admin cannot read patients" stays literal, no exception).
// Search reuses search_patients, the same RPC Reception's check-in screen
// calls -- SECURITY INVOKER, runs under the doctor's own RLS, no separate
// function needed for this.
function PatientSearch({ label, clinicId, selected, onSelect }: { label: string; clinicId: string; selected: Candidate | null; onSelect: (c: Candidate | null) => void }) {
  const [query, setQuery] = useState('')
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
      <label className="field-label">{label}</label>
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
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or phone" />
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

  // A warning list only: nothing merges until the doctor picks a pair, then confirms below.
  const { data: suggestions } = useQuery({
    queryKey: ['possible-duplicates', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('possible_duplicate_patients', { p_clinic_id: clinicId })
      if (error) throw error
      return data as DuplicatePair[]
    },
  })

  const merge = useMutation({
    mutationFn: async () => {
      if (!a || !b) return
      const { data, error } = await supabase.rpc('merge_patients', { p_patient_a: a.id, p_patient_b: b.id })
      if (error) throw error
      return data as string
    },
    onSuccess: (keptId) => {
      setResult(`Merged. The record kept is ${keptId === a?.id ? a?.name : b?.name}.`)
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

  const bothSelected = !!a && !!b
  const samePatient = bothSelected && a!.id === b!.id

  return (
    <div className="merge-patients-page">
      <div className="admin-toolbar">
        <h2 className="readout-heading">Merge duplicate patients</h2>
      </div>
      <p className="readout-empty">
        Combines two records into one. The older record is always kept. Blocked if either patient has an open visit today.
      </p>
      <PatientSearch label="Duplicate record A" clinicId={clinicId} selected={a} onSelect={setA} />
      <PatientSearch label="Duplicate record B" clinicId={clinicId} selected={b} onSelect={setB} />
      {samePatient && <p className="form-error">Pick two different patients.</p>}
      {result && <p className={result.startsWith('Merged') ? 'readout-empty' : 'form-error'}>{result}</p>}
      <div className="action-row">
        <Button
          type="button"
          disabled={!bothSelected || samePatient || merge.isPending}
          onClick={async () => {
            if (await confirm({ title: 'Merge these two patients?', body: `"${a?.name}" and "${b?.name}" become one record. This cannot be undone.`, confirmLabel: 'Merge' })) merge.mutate()
          }}
        >
          {merge.isPending ? 'Merging…' : 'Merge'}
        </Button>
      </div>
      {(suggestions?.length ?? 0) > 0 && (
        <section>
          <h3 className="readout-heading">Possible duplicates</h3>
          <p className="readout-empty">Matching name or phone is only a hint. Review each pair before merging; the older record is the one kept.</p>
          <ul className="merge-suggestion-list">
            {suggestions!.map((s) => (
              <li key={`${s.a.id}-${s.b.id}`} className="merge-suggestion">
                <span>
                  {brief(s.a)} <span className="search-result-meta">and</span> {brief(s.b)}
                  <span className="search-result-meta"> — {s.reason}</span>
                </span>
                <span className="merge-suggestion-actions">
                  <button type="button" className="merge-suggestion-review" onClick={() => { setA(s.a); setB(s.b); setResult(''); window.scrollTo({ top: 0, behavior: 'instant' }) }}>
                    Review
                  </button>
                  <button type="button" className="merge-suggestion-dismiss" disabled={dismiss.isPending && dismiss.variables === s} onClick={async () => { if (await confirm({ title: 'Not a duplicate?', body: `"${s.a.name}" and "${s.b.name}" will no longer be suggested as a pair.`, confirmLabel: 'Not a duplicate' })) dismiss.mutate(s) }}>
                    Not a duplicate
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
