import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

type Procedure = { id: string; name: string; default_price_paise: number }
type VisitProcedure = { id: string; procedure_id: string; price_paise: number; procedures: { name: string } | null }
type Pricing = { calculated_total_paise: number; final_amount_paise: number; discount_paise: number; revision_number: number }

// Paise -> rupees for display only, integer arithmetic throughout (no /100
// float division) -- money itself never leaves bigint paise.
function formatPaise(paise: number): string {
  const rupees = Math.floor(paise / 100)
  const cents = paise % 100
  return `₹${rupees}.${String(cents).padStart(2, '0')}`
}

// Same value, formatted for an editable rupees field: no trailing ".00" for
// a whole-rupee amount, so an untouched field doesn't read as "changed".
function formatPaiseForInput(paise: number): string {
  const rupees = Math.floor(paise / 100)
  const cents = paise % 100
  return cents === 0 ? String(rupees) : `${rupees}.${String(cents).padStart(2, '0')}`
}

// Parses what the doctor typed -- rupees, optionally with up to 2 decimal
// places (procedures can legitimately price at e.g. 7.50) -- into integer
// paise via string splitting, never parseFloat/Number division: a real
// price like 7.50 has no exact binary float representation, and this is
// the one arithmetic path in the whole feature that a doctor's keystrokes
// drive directly. Returns null for anything that isn't a plain non-negative
// rupees[.paise] number.
function parseRupeesToPaise(input: string): number | null {
  const trimmed = input.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [rupees, paise = ''] = trimmed.split('.')
  return Number(rupees) * 100 + Number((paise + '00').slice(0, 2))
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
        .select('calculated_total_paise, final_amount_paise, discount_paise, revision_number')
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

  const addProcedure = useMutation({
    mutationFn: async (procedure: Procedure) => {
      const { error } = await supabase.from('visit_procedures').insert({
        clinic_id: clinicId,
        visit_id: visitId,
        procedure_id: procedure.id,
        price_paise: procedure.default_price_paise,
      })
      if (error) throw error
    },
    onSuccess: invalidateAll,
  })

  const updatePrice = useMutation({
    mutationFn: async ({ id, price_paise }: { id: string; price_paise: number }) => {
      const { error } = await supabase.from('visit_procedures').update({ price_paise }).eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidateAll,
  })

  const removeProcedure = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('visit_procedures').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: invalidateAll,
  })

  const [finalAmountDraft, setFinalAmountDraft] = useState('')
  const [finalAmountError, setFinalAmountError] = useState('')
  useEffect(() => {
    if (pricing) setFinalAmountDraft(formatPaiseForInput(pricing.final_amount_paise))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricing?.final_amount_paise])

  const updateFinalAmount = useMutation({
    mutationFn: async (value: number) => {
      const { error } = await supabase.from('visit_pricing').update({ final_amount_paise: value }).eq('visit_id', visitId)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pricingKey }),
  })

  function commitFinalAmount() {
    if (!pricing) return
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
    if (value === pricing.final_amount_paise) return
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
                onChange={(e) => setFinalAmountDraft(e.target.value)}
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
