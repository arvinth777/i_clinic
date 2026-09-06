import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatPaise, formatPaiseForInput, parseRupeesToPaise } from '../lib/money'
import { attemptOrQueue } from '../lib/offlineQueue'

type Procedure = { id: string; name: string; default_price_paise: number }
type VisitProcedure = { id: string; procedure_id: string; price_paise: number; procedures: { name: string } | null }
type Pricing = {
  calculated_total_paise: number
  final_amount_paise: number
  discount_paise: number
  revision_number: number
  final_amount_set: boolean
}

export function PricingPanel({ clinicId, visitId }: { clinicId: string; visitId: string }) {
  const queryClient = useQueryClient()

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

  const visitProceduresKey = ['visit-procedures', visitId]
  const { data: visitProcedures } = useQuery({
    queryKey: visitProceduresKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visit_procedures')
        .select('id, procedure_id, price_paise, procedures(name)')
        .eq('visit_id', visitId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as unknown as VisitProcedure[]
    },
  })

  const pricingKey = ['visit-pricing', visitId]
  const { data: pricing } = useQuery({
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
        () => queryClient.invalidateQueries({ queryKey: pricingKey }),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId])

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: visitProceduresKey })
    queryClient.invalidateQueries({ queryKey: pricingKey })
  }

  // calculated_total_paise/final_amount_paise are normally recomputed
  // server-side (recompute_visit_pricing, a trigger on visit_procedures)
  // -- offline, nothing runs that trigger, so the optimistic patches below
  // mirror its exact arithmetic locally (mirrored again in reverse for a
  // removal) so this screen -- and print, if billing follows straight from
  // here -- reflects the real total without a round trip.
  function patchTotal(deltaPaise: number) {
    queryClient.setQueryData<Pricing>(pricingKey, (old) => {
      if (!old) return old
      const total = old.calculated_total_paise + deltaPaise
      return { ...old, calculated_total_paise: total, final_amount_paise: old.final_amount_set ? Math.min(old.final_amount_paise, total) : total }
    })
  }

  const addProcedure = useMutation({
    networkMode: 'always',
    mutationFn: async (procedure: Procedure) => {
      const id = crypto.randomUUID()
      const row = { id, clinic_id: clinicId, visit_id: visitId, procedure_id: procedure.id, price_paise: procedure.default_price_paise }
      await attemptOrQueue({
        attempt: () => supabase.from('visit_procedures').insert(row),
        queueItem: () => ({ kind: 'insert', table: 'visit_procedures', payload: row, description: `Add procedure "${procedure.name}"` }),
        applyOptimistic: () => {
          queryClient.setQueryData<VisitProcedure[]>(visitProceduresKey, (old) => [...(old ?? []), { id, procedure_id: procedure.id, price_paise: procedure.default_price_paise, procedures: { name: procedure.name } }])
          patchTotal(procedure.default_price_paise)
        },
      })
    },
    onSuccess: invalidateAll,
  })

  const updatePrice = useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, price_paise }: { id: string; price_paise: number }) => {
      const previous = visitProcedures?.find((r) => r.id === id)?.price_paise ?? price_paise
      await attemptOrQueue({
        attempt: () => supabase.from('visit_procedures').update({ price_paise }).eq('id', id),
        queueItem: () => ({ kind: 'update', table: 'visit_procedures', payload: { price_paise }, match: { id }, description: 'Update a procedure price' }),
        applyOptimistic: () => {
          queryClient.setQueryData<VisitProcedure[]>(visitProceduresKey, (old) => old?.map((r) => (r.id === id ? { ...r, price_paise } : r)))
          patchTotal(price_paise - previous)
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
        attempt: () => supabase.from('visit_procedures').delete().eq('id', id),
        queueItem: () => ({ kind: 'delete', table: 'visit_procedures', match: { id }, description: `Remove procedure "${removed?.procedures?.name ?? ''}"` }),
        applyOptimistic: () => {
          queryClient.setQueryData<VisitProcedure[]>(visitProceduresKey, (old) => old?.filter((r) => r.id !== id))
          if (removed) patchTotal(-removed.price_paise)
        },
      })
    },
    onSuccess: invalidateAll,
  })

  const [finalAmountDraft, setFinalAmountDraft] = useState('')
  const [finalAmountDirty, setFinalAmountDirty] = useState(false)
  const [finalAmountError, setFinalAmountError] = useState('')
  useEffect(() => {
    if (pricing) {
      setFinalAmountDraft(formatPaiseForInput(pricing.final_amount_paise))
      setFinalAmountDirty(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricing?.final_amount_paise])

  const updateFinalAmount = useMutation({
    networkMode: 'always',
    mutationFn: async (value: number) => {
      await attemptOrQueue({
        attempt: () => supabase.from('visit_pricing').update({ final_amount_paise: value }).eq('visit_id', visitId),
        queueItem: () => ({ kind: 'update', table: 'visit_pricing', payload: { final_amount_paise: value }, match: { visit_id: visitId }, description: 'Set the final amount' }),
        applyOptimistic: () =>
          queryClient.setQueryData<Pricing>(pricingKey, (old) => (old ? { ...old, final_amount_paise: value, final_amount_set: true } : old)),
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pricingKey }),
  })

  // Reception's billing screen blocks payment until final_amount_set is
  // true, so a doctor who's happy with the default (no discount) still has
  // to actively confirm it -- but an incidental tab-through of an
  // already-set field must not silently re-fire a write. Send when the
  // field was genuinely edited (dirty), or when it hasn't been set yet at
  // all (the one case where even an unchanged value is a real confirm).
  function commitFinalAmount() {
    if (!pricing) return
    if (!finalAmountDirty && pricing.final_amount_set) return
    const value = parseRupeesToPaise(finalAmountDraft)
    if (value === null) {
      setFinalAmountError("Final amount can't be less than 0")
      return
    }
    if (value > pricing.calculated_total_paise) {
      setFinalAmountError("Final amount can't be more than the calculated total")
      return
    }
    setFinalAmountError('')
    setFinalAmountDirty(false)
    updateFinalAmount.mutate(value)
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
      <section className="record-section">
        <h3 className="readout-heading">Procedures</h3>
        {procedures && procedures.length > 0 && (
          <ul className="search-results">
            {procedures.map((p) => (
              <li key={p.id}>
                <button type="button" className="search-result-button" onClick={() => addProcedure.mutate(p)}>
                  <span>{p.name}</span>
                  <span className="search-result-meta">{formatPaise(p.default_price_paise)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {!visitProcedures || visitProcedures.length === 0 ? (
          <p className="readout-empty">No procedures added for this visit.</p>
        ) : (
          <ul className="past-visit-list">
            {visitProcedures.map((row) => (
              <li key={row.id} className="past-visit-item procedure-item">
                <span className="procedure-item-name">{row.procedures?.name}</span>
                <input
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
        <h3 className="readout-heading">Pricing</h3>
        {!pricing ? (
          <p className="readout-empty">Loading…</p>
        ) : (
          <div className="pricing-block">
            <div className="pricing-row">
              <span>Calculated total</span>
              <span className="pricing-value">{formatPaise(pricing.calculated_total_paise)}</span>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="final-amount">
                Final amount (₹)
              </label>
              <input
                id="final-amount"
                inputMode="decimal"
                value={finalAmountDraft}
                onChange={(e) => {
                  setFinalAmountDraft(e.target.value)
                  setFinalAmountDirty(true)
                }}
                onBlur={commitFinalAmount}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              {finalAmountError && (
                <span className="field-error" role="alert">
                  {finalAmountError}
                </span>
              )}
            </div>
            <div className="pricing-row">
              <span>Discount</span>
              <span className="pricing-value">{formatPaise(pricing.discount_paise)}</span>
            </div>
          </div>
        )}
        {updateFinalAmount.isError && <p className="form-error">Couldn't save — try again.</p>}
      </section>
    </>
  )
}
