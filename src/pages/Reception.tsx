import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { attemptOrQueue } from '../lib/offlineQueue'
import { useClinicId } from '../lib/useClinicId'
import { startOfToday } from '../lib/date'
import { NewPatientForm, type NewPatientInput } from '../components/NewPatientForm'
import { TokenList } from '../components/TokenList'
import { stageLabel } from '../lib/stageLabels'
import { Billing } from '../components/Billing'
import { FollowUpTodos } from '../components/FollowUpTodos'
import { Button, buttonVariants } from '../components/ui/button'
import { Input } from '../components/ui/input'
import './Reception.css'


type SearchResult = {
  id: string
  name: string
  age: number | null
  gender: string | null
  phone: string | null
  address: string | null
}

export function Reception({ userId, readOnly = false, highlightVisitId }: { userId: string; readOnly?: boolean; highlightVisitId?: string }) {
  const queryClient = useQueryClient()
  const { data: clinicId } = useClinicId(userId)

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selected, setSelected] = useState<SearchResult | 'new' | null>(null)
  const [complaint, setComplaint] = useState('')
  const [billingVisitId, setBillingVisitId] = useState<string | null>(null)
  const [repFormOpen, setRepFormOpen] = useState(false)
  const [repName, setRepName] = useState('')
  const [repCompany, setRepCompany] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const { data: results, isFetching: searching } = useQuery({
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

  // A patient already waiting or with the doctor today: warn before issuing a second token.
  const { data: openToday } = useQuery({
    queryKey: ['open-visit-today', selected && selected !== 'new' ? selected.id : null],
    enabled: !!selected && selected !== 'new',
    queryFn: async () => {
      const { data, error } = await supabase.from('visits').select('token_number, stage').eq('patient_id', (selected as SearchResult).id)
        .gte('arrived_at', startOfToday()).not('stage', 'in', '(paid,no_show)').limit(1)
      if (error) throw error
      return data
    },
  })

  const checkInExisting = useMutation({
    // token_number is assigned server-side (schema comment, phase1_core_
    // schema.sql) precisely so check-in itself can be queued offline --
    // arrived_at, captured here at the client, is the real queue sort key
    // regardless of when this row actually lands in Postgres.
    networkMode: 'always',
    mutationFn: async () => {
      if (selected === 'new' || !selected || !clinicId) return
      const row = { id: crypto.randomUUID(), clinic_id: clinicId, patient_id: selected.id, arrived_at: new Date().toISOString(), complaint }
      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.from('visits').insert(row).setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({ kind: 'insert', table: 'visits', payload: row, description: `Check in ${selected.name}` }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits-today', clinicId] })
      reset()
    },
  })

  const checkInNew = useMutation({
    networkMode: 'always',
    mutationFn: async (input: NewPatientInput) => {
      if (!clinicId) return
      const patientId = crypto.randomUUID()
      const patientRow = {
        id: patientId,
        clinic_id: clinicId,
        name: input.name,
        age: Number(input.age),
        height_cm: input.height.trim() ? Number(input.height) : null,
        weight_kg: input.weight.trim() ? Number(input.weight) : null,
        gender: input.gender || null,
        address: input.address || null,
        phone: input.phone || null,
        custom_fields: input.customFields,
      }
      const visitRow = { id: crypto.randomUUID(), clinic_id: clinicId, patient_id: patientId, arrived_at: new Date().toISOString(), complaint: input.complaint }

      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.from('patients').insert(patientRow).setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({ kind: 'insert', table: 'patients', payload: patientRow, description: `Register new patient ${input.name}` }),
      })
      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.from('visits').insert(visitRow).setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({ kind: 'insert', table: 'visits', payload: visitRow, description: `Check in ${input.name}` }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visits-today', clinicId] })
      reset()
    },
  })

  const checkInRep = useMutation({
    mutationFn: async () => {
      if (!clinicId) return
      const { error } = await supabase
        .from('pharma_rep_checkins')
        .insert({ clinic_id: clinicId, rep_name: repName, company: repCompany, checked_in_by: userId })
      if (error) throw error
    },
    onSuccess: () => {
      setRepFormOpen(false)
      setRepName('')
      setRepCompany('')
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
    <div className={billingVisitId ? 'reception-page reception-billing' : 'reception-page'}>
      <div className="reception-shell">
        {!readOnly && <aside className="reception-rail" aria-label="Patient check-in"><div className="sticky-panel">
          <div><h2 className="readout-heading">Check in</h2><p className="field-hint">Find a returning patient by name, phone or token.</p></div>
          <div className="search-field search-results-anchor">
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
              aria-label="Find patient"
              placeholder="Search by name, phone or token"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results && results.length > 0) {
                  e.preventDefault()
                  setSelected(results[0]); setQuery(''); setRepFormOpen(false)
                }
              }}
            />
            {debouncedQuery && (results?.length ?? 0) > 0 && (
              <ul className="search-results">
                {results!.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="search-result-button"
                      data-press="tap"
                      onClick={() => { setSelected(r); setQuery(''); setDebouncedQuery(''); setRepFormOpen(false) }}
                    >
                      {r.name}
                      {r.phone || r.age ? (
                        <span className="search-result-meta">
                          {' '}
                          {r.phone ? `— ${r.phone}` : ''} {r.age ? `— ${r.age}y` : ''}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {debouncedQuery && debouncedQuery === query.trim() && !searching && results && results.length === 0 && (
              <div className="no-match">
                <p>No matching patient found.</p>
              </div>
            )}
          </div>
          <div className="rail-actions">
            <Button type="button" variant="dark" onClick={() => { setSelected('new'); setRepFormOpen(false) }}>
              Register new patient
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setSelected(null); setRepFormOpen(true) }}>
              Check in pharma rep
            </Button>
          </div>

          {selected === 'new' ? (
            <>
              <button type="button" className="back-to-queue" onClick={reset}>
                ← Back to queue
              </button>
              <NewPatientForm clinicId={clinicId} initialName={debouncedQuery} onSubmit={(input: NewPatientInput) => checkInNew.mutate(input)} submitting={checkInNew.isPending} />
              {checkInNew.isError && <p className="form-error" role="alert">{checkInNew.error.message}</p>}
              <div className="action-row">
                <Button type="button" variant="secondary" onClick={reset}>
                  Cancel
                </Button>
              </div>
            </>
          ) : selected ? (
            <>
              <button type="button" className="back-to-queue" onClick={reset}>
                ← Back to queue
              </button>
              <h2 className="readout-heading">{selected.name}</h2>
              {openToday?.[0] && <p className="status-amber" role="status">Already in today's queue as #{openToday[0].token_number} ({stageLabel(openToday[0].stage)}). Check in only if this is a new visit.</p>}
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
                  <Input id="complaint" value={complaint} onChange={(e) => setComplaint(e.target.value)} required autoFocus />
                </div>
                <div className="action-row">
                  <button type="submit" className={buttonVariants({ variant: 'primary' })} data-press="stamp" disabled={checkInExisting.isPending}>
                    {checkInExisting.isPending ? 'Checking in…' : 'Check in'}
                  </button>
                  <Button type="button" variant="secondary" onClick={reset}>
                    Cancel
                  </Button>
                </div>
                {checkInExisting.isError && <p className="form-error">Couldn't save — try again.</p>}
              </form>
            </>
          ) : repFormOpen ? (
            <>
              <button type="button" className="back-to-queue" onClick={() => setRepFormOpen(false)}>
                ← Back to queue
              </button>
              <h2 className="readout-heading">Check in pharma rep</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  checkInRep.mutate()
                }}
              >
                <div className="field">
                  <label className="field-label" htmlFor="rep-name">
                    Rep name
                  </label>
                  <Input id="rep-name" value={repName} onChange={(e) => setRepName(e.target.value)} required autoFocus />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="rep-company">
                    Company
                  </label>
                  <Input id="rep-company" value={repCompany} onChange={(e) => setRepCompany(e.target.value)} required />
                </div>
                <div className="action-row">
                  <button type="submit" className={buttonVariants({ variant: 'primary' })} data-press="stamp" disabled={checkInRep.isPending}>
                    {checkInRep.isPending ? 'Checking in…' : 'Check in'}
                  </button>
                  <Button type="button" variant="secondary" onClick={() => setRepFormOpen(false)}>
                    Cancel
                  </Button>
                </div>
                {checkInRep.isError && <p className="form-error">Couldn't save — try again.</p>}
              </form>
            </>
          ) : null}
          <details className="reception-followups"><summary>Follow-ups due today</summary><FollowUpTodos clinicId={clinicId} /></details>
        </div></aside>}

        <div className="reception-stage">
          {billingVisitId ? (
            <>
              <button type="button" className="back-to-queue" onClick={() => setBillingVisitId(null)}>
                ← Back to queue
              </button>
              <Billing key={billingVisitId} clinicId={clinicId} visitId={billingVisitId} onClose={() => setBillingVisitId(null)} />
            </>
          ) : (
            <div className="worklist-panel">
              <h2 className="readout-heading">Today's queue</h2>
              <TokenList highlightVisitId={highlightVisitId} clinicId={clinicId} onSelectVisit={readOnly ? undefined : setBillingVisitId} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
