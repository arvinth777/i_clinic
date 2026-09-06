import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

type Medicine = { id: string; name: string }
type StockPoint = { id: string; name: string }

export function AdjustStockForm({
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
  const [medicineId, setMedicineId] = useState('')
  const [stockPointId, setStockPointId] = useState('')
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      const parsedDelta = Number(delta)
      if (!Number.isInteger(parsedDelta) || parsedDelta === 0) throw new Error('Enter a non-zero whole-number change')
      if (!reason.trim()) throw new Error('Enter a reason')

      const { error } = await supabase.rpc('adjust_stock', {
        p_clinic_id: clinicId,
        p_medicine_id: medicineId,
        p_stock_point_id: stockPointId,
        p_quantity_delta: parsedDelta,
        p_reason: reason.trim(),
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
        <label className="field-label" htmlFor="adjust-medicine">
          Drug
        </label>
        <select id="adjust-medicine" value={medicineId} onChange={(e) => setMedicineId(e.target.value)} required autoFocus>
          <option value="">— Choose —</option>
          {medicines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="adjust-stock-point">
          Stock point
        </label>
        <select id="adjust-stock-point" value={stockPointId} onChange={(e) => setStockPointId(e.target.value)} required>
          <option value="">— Choose —</option>
          {stockPoints.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="adjust-delta">
          Change (use a minus sign to remove stock, e.g. -2)
        </label>
        <input id="adjust-delta" type="number" value={delta} onChange={(e) => setDelta(e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="adjust-reason">
          Reason
        </label>
        <input id="adjust-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. damaged in transit" required />
      </div>
      {formError && <p className="form-error">{formError}</p>}
      <div className="action-row">
        <button type="submit" className="primary-button" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Adjust'}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
