import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

type Candidate = { id: string; name: string; age: number | null; phone: string | null; created_at: string }

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// admin has no row-level read on patients at all (docs/architecture-
// spec.md's Phase E constraint -- aggregates only). This screen's search
// goes through admin_search_patients_for_merge, a narrow SECURITY DEFINER
// read scoped to exactly this job (name/age/phone/created_at, nothing
// clinical), not a blanket relaxation of patients_select.
function PatientSearch({ label, clinicId, selected, onSelect }: { label: string; clinicId: string; selected: Candidate | null; onSelect: (c: Candidate) => void }) {
  const [query, setQuery] = useState('')
  const { data: results } = useQuery({
    queryKey: ['merge-search', clinicId, query],
    enabled: query.trim().length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_search_patients_for_merge', { p_clinic_id: clinicId, p_query: query.trim() })
      if (error) throw error
      return data as Candidate[]
    },
  })

  return (
    <div className="field">
      <label className="field-label">{label}</label>
      {selected ? (
        <div className="search-result-button" style={{ cursor: 'default' }}>
          <span>
            {selected.name} <span className="search-result-meta">— {selected.phone ?? 'no phone'} — checked in {formatDate(selected.created_at)}</span>
          </span>
          <button type="button" className="drug-row-remove" onClick={() => onSelect(null as unknown as Candidate)}>
            Change
          </button>
        </div>
      ) : (
        <>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or phone" />
          {query.trim() && (results?.length ?? 0) > 0 && (
            <ul className="search-results">
              {results!.map((c) => (
                <li key={c.id}>
                  <button type="button" className="search-result-button" onClick={() => onSelect(c)}>
                    {c.name}
                    <span className="search-result-meta">
                      {c.phone ? `— ${c.phone}` : ''} — since {formatDate(c.created_at)}
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
  const [a, setA] = useState<Candidate | null>(null)
  const [b, setB] = useState<Candidate | null>(null)
  const [result, setResult] = useState('')

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
    },
    onError: (e: Error) => setResult(e.message),
  })

  const bothSelected = !!a && !!b
  const samePatient = bothSelected && a!.id === b!.id

  return (
    <div>
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
        <button
          type="button"
          className="primary-button"
          disabled={!bothSelected || samePatient || merge.isPending}
          onClick={() => {
            if (confirm(`Merge "${a?.name}" and "${b?.name}"? This cannot be undone.`)) merge.mutate()
          }}
        >
          {merge.isPending ? 'Merging…' : 'Merge'}
        </button>
      </div>
    </div>
  )
}
