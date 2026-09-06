import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

type Medicine = { id: string; name: string }
type StockPoint = { id: string; name: string }

export function TransferForm({
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
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      if (fromId === toId) throw new Error('Choose two different stock points')
      const qty = Number(quantity)
      if (!Number.isInteger(qty) || qty <= 0) throw new Error('Enter a valid quantity')

      const { error } = await supabase.rpc('create_stock_transfer', {
        p_clinic_id: clinicId,
        p_medicine_id: medicineId,
        p_from_stock_point_id: fromId,
        p_to_stock_point_id: toId,
        p_quantity: qty,
        p_notes: notes.trim() || null,
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
        <label className="field-label" htmlFor="transfer-medicine">
          Drug
        </label>
        <select id="transfer-medicine" value={medicineId} onChange={(e) => setMedicineId(e.target.value)} required autoFocus>
          <option value="">— Choose —</option>
          {medicines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="transfer-from">
          From
        </label>
        <select id="transfer-from" value={fromId} onChange={(e) => setFromId(e.target.value)} required>
          <option value="">— Choose —</option>
          {stockPoints.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="transfer-to">
          To
        </label>
        <select id="transfer-to" value={toId} onChange={(e) => setToId(e.target.value)} required>
          <option value="">— Choose —</option>
          {stockPoints.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="transfer-quantity">
          Quantity
        </label>
        <input id="transfer-quantity" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="transfer-notes">
          Notes (optional)
        </label>
        <input id="transfer-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {formError && <p className="form-error">{formError}</p>}
      <div className="action-row">
        <button type="submit" className="primary-button" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Transfer'}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
