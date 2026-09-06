import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

type Medicine = { id: string; name: string }
type StockPoint = { id: string; name: string }

export function MonthlyCountForm({
  clinicId,
  medicines,
  stockPoints,
  onDone,
  onCancel,
}: {
  clinicId: string
  medicines: Medicine[]
  stockPoints: StockPoint[]
  onDone: () => void
  onCancel: () => void
}) {
  const [stockPointId, setStockPointId] = useState('')
  const [counted, setCounted] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')

  const { data: expected } = useQuery({
    queryKey: ['stock-for-count', clinicId, stockPointId],
    enabled: !!stockPointId,
    queryFn: async () => {
      const { data, error } = await supabase.from('medicine_stock').select('medicine_id, quantity').eq('clinic_id', clinicId).eq('stock_point_id', stockPointId)
      if (error) throw error
      return new Map((data as { medicine_id: string; quantity: number }[]).map((r) => [r.medicine_id, r.quantity]))
    },
  })

  function expectedFor(medicineId: string): number {
    return expected?.get(medicineId) ?? 0
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!stockPointId) throw new Error('Choose a stock point')
      const lines = Object.entries(counted)
        .filter(([, v]) => v.trim() !== '')
        .map(([medicine_id, v]) => {
          const counted_quantity = Number(v)
          if (!Number.isInteger(counted_quantity) || counted_quantity < 0) throw new Error('Enter a valid counted quantity')
          return { medicine_id, counted_quantity }
        })
      if (lines.length === 0) throw new Error('Enter at least one counted quantity')

      const { error } = await supabase.rpc('record_stock_count', {
        p_clinic_id: clinicId,
        p_stock_point_id: stockPointId,
        p_lines: lines,
      })
      if (error) throw error
    },
    onSuccess: onDone,
    onError: (e: Error) => setFormError(e.message),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor="count-stock-point">
          Stock point
        </label>
        <select id="count-stock-point" value={stockPointId} onChange={(e) => setStockPointId(e.target.value)} required autoFocus>
          <option value="">— Choose —</option>
          {stockPoints.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.name}
            </option>
          ))}
        </select>
      </div>

      {stockPointId && (
        <div className="worklist-scroll">
          <table className="worklist stock-count-table">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Expected</th>
                <th>Counted</th>
                <th>Gap</th>
              </tr>
            </thead>
            <tbody>
              {medicines.map((m) => {
                const exp = expectedFor(m.id)
                const enteredRaw = counted[m.id] ?? ''
                const entered = enteredRaw.trim() === '' ? null : Number(enteredRaw)
                const gap = entered === null ? null : entered - exp
                return (
                  <tr key={m.id} className="worklist-row">
                    <td className="worklist-name-cell">{m.name}</td>
                    <td className="worklist-wait-cell">{exp}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={enteredRaw}
                        onChange={(e) => setCounted((c) => ({ ...c, [m.id]: e.target.value }))}
                      />
                    </td>
                    <td className={`worklist-wait-cell ${gap != null && gap < 0 ? 'stock-qty-negative' : ''}`}>{gap ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {formError && <p className="form-error">{formError}</p>}
      <div className="action-row">
        <button type="submit" className="primary-button" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Confirm count'}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
