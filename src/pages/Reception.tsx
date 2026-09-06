import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { supabase } from '../lib/supabase'
import { useClinicId } from '../lib/useClinicId'
import { NewPatientForm, type NewPatientInput } from '../components/NewPatientForm'
import { TokenList } from '../components/TokenList'
import { Billing } from '../components/Billing'
import { Drawer } from '../components/Drawer'
import './Reception.css'

const tap = { scale: 0.97 }
// A small press-and-tilt, reserved for the one moment this action really is
// a stamp on the record (checking a patient in) -- not applied to every
// button, or it stops meaning anything.
const stampTap = { scale: 0.96, rotate: -1 }

type SearchResult = {
  id: string
  name: string
  age: number | null
  gender: string | null
  phone: string | null
  address: string | null
}

export function Reception({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const { data: clinicId } = useClinicId(userId)

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selected, setSelected] = useState<SearchResult | 'new' | null>(null)
  const [complaint, setComplaint] = useState('')
  const [billingVisitId, setBillingVisitId] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const { data: results } = useQuery({
    queryKey: ['search-patients', clinicId, debouncedQuery],
    enabled: !!clinicId && debouncedQuery.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_patients', {
        p_clinic_id: clinicId,
        p_query: debouncedQuery,
      })
      if (error) throw error
      return data as SearchResult[]
    },
  })

  const checkInExisting = useMutation({
    mutationFn: async () => {
      if (selected === 'new' || !selected || !clinicId) return
      const { error } = await supabase.from('visits').insert({
        clinic_id: clinicId,
        patient_id: selected.id,
        arrived_at: new Date().toISOString(),
        complaint,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits-today', clinicId] })
      reset()
    },
  })

  const checkInNew = useMutation({
    mutationFn: async (input: NewPatientInput) => {
      if (!clinicId) return
      const { data: patient, error: patientErr } = await supabase
        .from('patients')
        .insert({
          clinic_id: clinicId,
          name: input.name,
          age: Number(input.age),
          gender: input.gender || null,
          address: input.address || null,
          phone: input.phone || null,
          custom_fields: input.customFields,
        })
        .select('id')
        .single()
      if (patientErr) throw patientErr

      const { error: visitErr } = await supabase.from('visits').insert({
        clinic_id: clinicId,
        patient_id: patient.id,
        arrived_at: new Date().toISOString(),
        complaint: input.complaint,
      })
      if (visitErr) throw visitErr
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits-today', clinicId] })
      reset()
    },
  })

  function reset() {
    setQuery('')
    setDebouncedQuery('')
    setSelected(null)
    setComplaint('')
  }

  if (!clinicId) return null

  return (
    <div className="reception-page">
      <div className="reception-toolbar">
        <div className="search-field">
          <svg
            className="search-field-icon"
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="7.5" cy="7.5" r="5.5" />
            <line x1="15.5" y1="15.5" x2="11.4" y2="11.4" />
          </svg>
          <input
            className="search-strip"
            type="search"
            placeholder="Search by name or phone"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results && results.length > 0) {
                e.preventDefault()
                setSelected(results[0])
              }
            }}
          />
          {debouncedQuery && (results?.length ?? 0) > 0 && (
            <ul className="search-results">
              {results!.map((r) => (
                <li key={r.id}>
                  <motion.button
                    type="button"
                    className="search-result-button"
                    whileTap={tap}
                    onClick={() => setSelected(r)}
                  >
                    {r.name}
                    {r.phone || r.age ? (
                      <span className="search-result-meta">
                        {' '}
                        {r.phone ? `— ${r.phone}` : ''} {r.age ? `— ${r.age}y` : ''}
                      </span>
                    ) : null}
                  </motion.button>
                </li>
              ))}
            </ul>
          )}
          {debouncedQuery && (results?.length ?? 0) === 0 && (
            <div className="no-match">
              <p>No matching patient found.</p>
            </div>
          )}
        </div>
        <motion.button type="button" className="secondary-button" whileTap={tap} onClick={() => setSelected('new')}>
          + New patient
        </motion.button>
      </div>

      <div className="worklist-panel">
        <h2 className="readout-heading">Today's queue</h2>
        <TokenList clinicId={clinicId} onSelectVisit={setBillingVisitId} />
      </div>

      <Drawer open={!!billingVisitId} onClose={() => setBillingVisitId(null)} title="Bill">
        {billingVisitId && (
          <Billing key={billingVisitId} clinicId={clinicId} visitId={billingVisitId} onClose={() => setBillingVisitId(null)} />
        )}
      </Drawer>

      <Drawer open={selected !== null && selected !== 'new'} onClose={reset} title={selected !== 'new' ? selected?.name : ''}>
        {selected && selected !== 'new' && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              checkInExisting.mutate()
            }}
          >
            <div className="field">
              <label className="field-label" htmlFor="complaint">
                Complaint
              </label>
              <input id="complaint" value={complaint} onChange={(e) => setComplaint(e.target.value)} required autoFocus />
            </div>
            <div className="action-row">
              <motion.button type="submit" className="primary-button" whileTap={stampTap} disabled={checkInExisting.isPending}>
                {checkInExisting.isPending ? 'Checking in…' : 'Check in'}
              </motion.button>
              <motion.button type="button" className="secondary-button" whileTap={tap} onClick={reset}>
                Cancel
              </motion.button>
            </div>
            {checkInExisting.isError && <p className="form-error">Couldn't save — try again.</p>}
          </form>
        )}
      </Drawer>

      <Drawer open={selected === 'new'} onClose={reset} title="New patient">
        {selected === 'new' && (
          <>
            <NewPatientForm clinicId={clinicId} initialName={debouncedQuery} onSubmit={(input: NewPatientInput) => checkInNew.mutate(input)} submitting={checkInNew.isPending} />
            <div className="action-row">
              <motion.button type="button" className="secondary-button" whileTap={tap} onClick={reset}>
                Cancel
              </motion.button>
            </div>
          </>
        )}
      </Drawer>
    </div>
  )
}
