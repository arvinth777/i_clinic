import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { supabase } from '../lib/supabase'
import { useClinicId } from '../lib/useClinicId'
import { NewPatientForm, type NewPatientInput } from '../components/NewPatientForm'
import { TokenList } from '../components/TokenList'
import './Reception.css'

// The one focal moment on this screen: search -> confirm/new-patient is the
// whole task, so it gets one continuous-feeling transition instead of a
// hard cut. Everything else (hover, focus) is a plain CSS state change.
const panelTransition = { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const }
const panelMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: panelTransition,
}
const tap = { scale: 0.97 }

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

  const view = selected === 'new' ? 'new' : selected ? 'confirm' : 'search'

  return (
    <div className="reception-grid">
      <div>
        <AnimatePresence mode="wait">
          {view === 'search' && (
            <motion.div key="search" {...panelMotion}>
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
                autoFocus
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
                  <div className="action-row">
                    <motion.button
                      type="button"
                      className="primary-button"
                      whileTap={tap}
                      onClick={() => setSelected('new')}
                    >
                      New patient
                    </motion.button>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {view === 'confirm' && selected && selected !== 'new' && (
            <motion.form
              key="confirm"
              className="form-panel"
              {...panelMotion}
              onSubmit={(e) => {
                e.preventDefault()
                checkInExisting.mutate()
              }}
            >
              <h2 className="form-heading">{selected.name}</h2>
              <div className="field">
                <label className="field-label" htmlFor="complaint">
                  Complaint
                </label>
                <input
                  id="complaint"
                  value={complaint}
                  onChange={(e) => setComplaint(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="action-row">
                <motion.button
                  type="submit"
                  className="primary-button"
                  whileTap={tap}
                  disabled={checkInExisting.isPending}
                >
                  {checkInExisting.isPending ? 'Checking in…' : 'Check in'}
                </motion.button>
                <motion.button type="button" className="secondary-button" whileTap={tap} onClick={reset}>
                  Cancel
                </motion.button>
              </div>
            </motion.form>
          )}

          {view === 'new' && (
            <motion.div key="new" {...panelMotion}>
              <NewPatientForm
                initialName={debouncedQuery}
                onSubmit={(input) => checkInNew.mutate(input)}
                submitting={checkInNew.isPending}
              />
              <div className="action-row">
                <motion.button type="button" className="secondary-button" whileTap={tap} onClick={reset}>
                  Cancel
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="readout-section">
        <h2 className="readout-heading">Today's queue</h2>
        <TokenList clinicId={clinicId} />
      </div>
    </div>
  )
}
