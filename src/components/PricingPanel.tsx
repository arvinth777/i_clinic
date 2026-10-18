import { type PricingProposal, changeProposal } from '../lib/pricingProposal'
import { LoadingRows } from './QueryState'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatPaise, formatPaiseForInput, parseRupeesToPaise } from '../lib/money'
import { attemptOrQueue, listQueue } from '../lib/offlineQueue'
import { useVisitProcedures, visitProceduresKey, type VisitProcedure } from '../lib/useVisitProcedures'
import { Input } from './ui/input'
import { Button } from './ui/button'

type Procedure = { id: string; name: string; default_price_paise: number }
type Pricing = {
  calculated_total_paise: number
  final_amount_paise: number
  discount_paise: number
  revision_number: number
  final_amount_set: boolean
}

function LegacyQuantities({ clinicId, visitId }: { clinicId: string; visitId: string }) {
  const queryClient = useQueryClient()
  const [legacyHint, setLegacyHint] = useState('')
  const key = ['legacy-prescription-quantities', visitId]
  const { data: items } = useQuery({ queryKey: key, queryFn: async () => {
    const { data, error } = await supabase.from('prescription_items')
      .select('id, quantity_dispensed, prescriptions!inner(visit_id), medicines(name, stock_unit, unit_confirmed_at)')
      .eq('prescriptions.visit_id', visitId).is('unit_price_paise', null)
    if (error) throw error
    return data as unknown as { id: string; quantity_dispensed: number | null; medicines: { name: string; stock_unit: string | null; unit_confirmed_at: string | null } }[]
  } })
  const review = useMutation({ networkMode: 'always', mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
    await attemptOrQueue({ clinicId,
      attempt: token => supabase.from('prescription_items').update({ quantity_dispensed: quantity }).eq('id', id).setHeader('Authorization', `Bearer ${token}`),
      queueItem: () => ({ kind: 'update', table: 'prescription_items', payload: { quantity_dispensed: quantity }, match: { id }, description: 'Review legacy supplied quantity' }),
    })
  }, onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: key })
    queryClient.invalidateQueries({ queryKey: ['visit-pricing', visitId] })
    queryClient.invalidateQueries({ queryKey: ['past-prescriptions'] })
  } })
  if (!items?.length) return null
  return <div className="record-section">
    <p className="field-hint">Review older prescription quantities before approving this bill. Confirm medicine units under Stock first.</p>
    {items.map(item => <form className="action-row" key={item.id} onSubmit={event => {
      event.preventDefault()
      const quantity = Number(new FormData(event.currentTarget).get('quantity'))
      if (!item.medicines.unit_confirmed_at) setLegacyHint(`${item.medicines.name}: set its unit and price under Stock first, then confirm the quantity here.`)
      else if (!Number.isInteger(quantity) || quantity <= 0) setLegacyHint('Enter a whole number of units, 1 or more.')
      else { setLegacyHint(''); review.mutate({ id: item.id, quantity }) }
    }}>
      <label htmlFor={`legacy-${item.id}`}>{item.medicines.name} · {item.medicines.stock_unit ?? 'unit unconfirmed'}</label>
      <Input id={`legacy-${item.id}`} name="quantity" type="number" min="1" step="1" required defaultValue={item.quantity_dispensed ?? ''} />
      <Button type="submit" variant="secondary" disabled={review.isPending}>Confirm supplied quantity</Button>
    </form>)}
    {legacyHint && <p className="form-error" role="alert">{legacyHint}</p>}
    {review.isError && <p className="form-error">Couldn't confirm quantity — check the unit setup and retry.</p>}
  </div>
}

export function PricingPanel({ clinicId, visitId }: { clinicId: string; visitId: string; reviewRequested?: boolean }) {
  const queryClient = useQueryClient()
  const [procedureSearch, setProcedureSearch] = useState('')
  const [newProcedurePrice, setNewProcedurePrice] = useState('')
  const newProcedureIdentity = useRef<{ id: string; name: string } | null>(null)

  const proceduresKey = ['procedures', clinicId]
  const { data: procedures } = useQuery({
    queryKey: proceduresKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('procedures')
        .select('id, name, default_price_paise')
        .eq('clinic_id', clinicId)
        .order('name', { ascending: true })
      if (error) throw error
      return data as Procedure[]
    },
  })

  const { data: visitProcedures } = useVisitProcedures(visitId)

  const pricingKey = ['visit-pricing', visitId]
  useQuery({
    queryKey: pricingKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visit_pricing')
        .select('calculated_total_paise, final_amount_paise, discount_paise, revision_number, final_amount_set')
        .eq('visit_id', visitId)
        .single()
      if (error) throw error
      return data as Pricing
    },
  })

  const proposalKey = ['pricing-proposal',visitId]
  useQuery({queryKey:proposalKey,queryFn:async()=>{const pending=await listQueue();const {data:{session}}=await supabase.auth.getSession();const cached=queryClient.getQueryData<PricingProposal>(proposalKey);if(cached&&pending.some(m=>{
      if(m.clinicId!==clinicId||m.ownerId!==session?.user.id)return false
      const payload=m.payload as {p_visit_id?:string;visit_id?:string}|undefined
      return payload?.p_visit_id===visitId||payload?.visit_id===visitId||(m.table==='visit_procedures'&&!!visitProcedures?.some(p=>p.id===m.match?.id))
    }))return cached;const {data,error}=await supabase.rpc('get_pricing_proposal',{p_visit_id:visitId});if(error)throw error;return data as PricingProposal}})

  // calculated_total_paise and final_amount_paise both change server-side as
  // a side effect of triggers this component didn't itself fire (a
  // prescription confirming elsewhere on this screen, or a clamp on
  // removal) -- Realtime is the only way this panel finds out.
  useEffect(() => {
    const channel = supabase
      .channel(`visit-pricing-${visitId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visit_pricing', filter: `visit_id=eq.${visitId}` },
        () => { void queryClient.invalidateQueries({queryKey:pricingKey}); void queryClient.invalidateQueries({queryKey:proposalKey}) },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId])

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: proposalKey })
    queryClient.invalidateQueries({ queryKey: visitProceduresKey(visitId) })
    queryClient.invalidateQueries({ queryKey: pricingKey })
  }

  // calculated_total_paise/final_amount_paise are normally recomputed
  // server-side (recompute_visit_pricing, a trigger on visit_procedures)
  // -- offline, nothing runs that trigger, so the optimistic patches below
  // mirror its exact arithmetic locally (mirrored again in reverse for a
  // removal) so this screen -- and print, if billing follows straight from
  // here -- reflects the real total without a round trip.
  function patchTotal(deltaPaise: number, change: (lines: PricingProposal['lines']) => PricingProposal['lines']) {
    queryClient.setQueryData<PricingProposal|null>(proposalKey, old=>changeProposal(old,change))
    queryClient.setQueryData<Pricing>(pricingKey, (old) => {
      if (!old) return old
      const total = old.calculated_total_paise + deltaPaise
      return { ...old, calculated_total_paise: total, final_amount_paise: total, final_amount_set:false }
    })
  }

  const addProcedure = useMutation({
    networkMode: 'always',
    mutationFn: async (procedure: Procedure) => {
      const id = crypto.randomUUID()
      const row = { id, clinic_id: clinicId, visit_id: visitId, procedure_id: procedure.id, price_paise: procedure.default_price_paise }
      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.from('visit_procedures').insert(row).setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({ kind: 'insert', table: 'visit_procedures', payload: row, description: `Add procedure "${procedure.name}"` }),
        applyOptimistic: () => {
          queryClient.setQueryData<VisitProcedure[]>(visitProceduresKey(visitId), (old) => [...(old ?? []), { id, procedure_id: procedure.id, price_paise: procedure.default_price_paise, procedures: { name: procedure.name } }])
          patchTotal(procedure.default_price_paise,lines=>[...lines,{kind:'procedure',visit_procedure_id:id,procedure_id:procedure.id,quantity:1,unit_price_paise:procedure.default_price_paise,description:procedure.name,line_total_paise:procedure.default_price_paise}])
        },
      })
    },
    onSuccess: invalidateAll,
  })

  function addProcedureFromSearch(procedure: Procedure) {
    addProcedure.mutate(procedure)
    setProcedureSearch('')
  }

  const createProcedure = useMutation({
    networkMode: 'always',
    mutationFn: async (price: number) => {
      const name = procedureSearch.trim()
      if (!name) throw new Error('Enter a procedure name.')
      if (newProcedureIdentity.current?.name !== name) newProcedureIdentity.current = { id: crypto.randomUUID(), name }
      const procedure = { ...newProcedureIdentity.current, default_price_paise: price }
      const row = { ...procedure, clinic_id: clinicId }
      await attemptOrQueue({ clinicId,
        attempt: token => supabase.from('procedures').upsert(row, { onConflict: 'id', ignoreDuplicates: true }).setHeader('Authorization', `Bearer ${token}`),
        queueItem: () => ({ kind: 'insert', table: 'procedures', payload: row, description: `Add procedure "${name}"` }),
      })
      return procedure
    },
    onSuccess: procedure => {
      queryClient.invalidateQueries({ queryKey: proceduresKey })
      addProcedureFromSearch(procedure)
      newProcedureIdentity.current = null
      setNewProcedurePrice('')
    },
  })

  const filteredProcedures = procedureSearch.trim()
    ? (procedures ?? []).filter((p) => p.name.toLowerCase().includes(procedureSearch.trim().toLowerCase()))
    : []

  const updatePrice = useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, price_paise }: { id: string; price_paise: number }) => {
      const previous = visitProcedures?.find((r) => r.id === id)?.price_paise ?? price_paise
      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.from('visit_procedures').update({ price_paise }).eq('id', id).setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({ kind: 'update', table: 'visit_procedures', payload: { price_paise }, match: { id }, description: 'Update a procedure price' }),
        applyOptimistic: () => {
          queryClient.setQueryData<VisitProcedure[]>(visitProceduresKey(visitId), (old) => old?.map((r) => (r.id === id ? { ...r, price_paise } : r)))
          patchTotal(price_paise - previous,lines=>lines.map(l=>l.kind==='procedure'&&l.visit_procedure_id===id?{...l,unit_price_paise:price_paise,line_total_paise:price_paise}:l))
        },
      })
    },
    onSuccess: invalidateAll,
  })

  const removeProcedure = useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      const removed = visitProcedures?.find((r) => r.id === id)
      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.from('visit_procedures').delete().eq('id', id).setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({ kind: 'delete', table: 'visit_procedures', match: { id }, payload:{visit_id:visitId}, description: `Remove procedure "${removed?.procedures?.name ?? ''}"` }),
        applyOptimistic: () => {
          queryClient.setQueryData<VisitProcedure[]>(visitProceduresKey(visitId), (old) => old?.filter((r) => r.id !== id))
          if (removed) patchTotal(-removed.price_paise,lines=>lines.filter(l=>l.kind!=='procedure'||l.visit_procedure_id!==removed.id))
        },
      })
    },
    onSuccess: invalidateAll,
  })

  const chargeKey = ['visit-consultation-charge', visitId]
  const { data: charge } = useQuery({ queryKey: chargeKey, queryFn: async () => {
    const { data, error } = await supabase.from('visits').select('consultation_charge_paise').eq('id', visitId).single()
    if (error) throw error
    return data.consultation_charge_paise as number
  } })
  const [chargeDraft, setChargeDraft] = useState('')
  const [chargeDirty, setChargeDirty] = useState(false)
  const [chargeError, setChargeError] = useState('')
  useEffect(() => { if (charge !== undefined && !chargeDirty) setChargeDraft(formatPaiseForInput(charge)) }, [charge, chargeDirty])

  const updateCharge = useMutation({
    networkMode: 'always',
    mutationFn: async (value: number) => {
      const args = {p_visit_id:visitId,p_fee_paise:value}
      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.rpc('set_consultation_charge', args).setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({ kind: 'rpc', rpc: 'set_consultation_charge', payload: args, description: 'Set consultation charge' }),
        applyOptimistic: () => queryClient.setQueryData(chargeKey, value),
      })
    },
    onSuccess: () => { setChargeDirty(false); void queryClient.invalidateQueries({ queryKey: chargeKey }); void queryClient.invalidateQueries({ queryKey: ['reception-bill-plan', visitId] }) },
  })

  function commitCharge() {
    if (!chargeDirty) return
    const value = parseRupeesToPaise(chargeDraft)
    if (value === null) {
      setChargeError('Enter a non-negative consultation charge in rupees.')
      return
    }
    setChargeError('')
    updateCharge.mutate(value)
  }

  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({})

  function commitPrice(row: VisitProcedure) {
    const draft = priceDrafts[row.id]
    if (draft === undefined) return
    const value = parseRupeesToPaise(draft)
    if (value === null || value === row.price_paise) return
    updatePrice.mutate({ id: row.id, price_paise: value })
  }

  return (
    <>
      <LegacyQuantities clinicId={clinicId} visitId={visitId} />
      <section className="record-section">
        <h3 className="readout-heading">Procedures</h3>
        <div className="field search-results-anchor">
          <label className="field-label" htmlFor="procedure-search">
            Search procedures
          </label>
          <Input
            id="procedure-search"
            value={procedureSearch}
            onChange={(e) => setProcedureSearch(e.target.value)}
            placeholder="Search a procedure to add…"
          />
          {procedureSearch.trim() &&
            (filteredProcedures.length > 0 ? (
              <ul className="search-results">
                {filteredProcedures.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="search-result-button" onClick={() => addProcedureFromSearch(p)}>
                      <span>{p.name}</span>
                      <span className="search-result-meta">{formatPaise(p.default_price_paise)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="no-match">
                <p>No procedure named "{procedureSearch}" in the list.</p>
                <label className="field"><span className="field-label">Default price (₹)</span><Input inputMode="decimal" value={newProcedurePrice} onChange={e => setNewProcedurePrice(e.target.value)} placeholder="0.00" /></label>
                <Button type="button" variant="secondary" disabled={createProcedure.isPending || parseRupeesToPaise(newProcedurePrice) === null} onClick={() => { const price = parseRupeesToPaise(newProcedurePrice); if (price !== null) createProcedure.mutate(price) }}>{createProcedure.isPending ? 'Adding…' : 'Add procedure and use it'}</Button>
                {createProcedure.isError && <p className="form-error" role="alert">Could not add the procedure. Check the name and price, then retry.</p>}
              </div>
            ))}
        </div>
        {!visitProcedures || visitProcedures.length === 0 ? (
          <p className="readout-empty">No procedures added for this visit.</p>
        ) : (
          <ul className="past-visit-list">
            {visitProcedures.map((row) => (
              <li key={row.id} className="past-visit-item procedure-item">
                <span className="procedure-item-name">{row.procedures?.name}</span>
                <Input
                  className="procedure-price-input"
                  inputMode="decimal"
                  value={priceDrafts[row.id] ?? formatPaiseForInput(row.price_paise)}
                  onChange={(e) => setPriceDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                  onBlur={() => commitPrice(row)}
                  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                />
                <button type="button" className="drug-row-remove" onClick={() => removeProcedure.mutate(row.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {(addProcedure.isError || updatePrice.isError || removeProcedure.isError) && (
          <p className="form-error">Couldn't save — try again.</p>
        )}
      </section>

      <section className="record-section">
        <h3 className="readout-heading">Consultation charge</h3>
        {charge === undefined ? (
          <LoadingRows label="Loading…" />
        ) : (
          <div className="pricing-block">
            <div className="field">
              <label className="field-label" htmlFor="consultation-charge">
                Consultation charge (₹)
              </label>
              <Input
                id="consultation-charge"
                inputMode="decimal"
                value={chargeDraft}
                onChange={(e) => {
                  setChargeDraft(e.target.value)
                  setChargeDirty(true)
                }}
                onKeyDown={(e) => e.key === 'Enter' && commitCharge()}
              />
              {chargeError && (
                <span className="field-error" role="alert">
                  {chargeError}
                </span>
              )}
            </div>
          </div>
        )}
        <Button variant="dark" disabled={updateCharge.isPending || !chargeDirty} onClick={commitCharge}>Save charge</Button>
        {updateCharge.isSuccess && !chargeDirty && <span className="save-state save-state-ok" role="status">✓ Saved</span>}
        <p className="field-hint">Reception chooses the stocked product and bills its current catalog price. The charge defaults to ₹250 for a first visit and ₹200 for a returning patient.</p>
        {updateCharge.isError && <p className="form-error">{updateCharge.error.message}</p>}
      </section>
    </>
  )
}
