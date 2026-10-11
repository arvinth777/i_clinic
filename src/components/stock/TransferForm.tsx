import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

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
        <Select value={medicineId} onValueChange={setMedicineId}>
          <SelectTrigger id="transfer-medicine" autoFocus>
            <SelectValue placeholder="— Choose —" />
          </SelectTrigger>
          <SelectContent>
            {medicines.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="transfer-from">
          From
        </label>
        <Select value={fromId} onValueChange={setFromId}>
          <SelectTrigger id="transfer-from">
            <SelectValue placeholder="— Choose —" />
          </SelectTrigger>
          <SelectContent>
            {stockPoints.map((sp) => (
              <SelectItem key={sp.id} value={sp.id}>
                {sp.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="transfer-to">
          To
        </label>
        <Select value={toId} onValueChange={setToId}>
          <SelectTrigger id="transfer-to">
            <SelectValue placeholder="— Choose —" />
          </SelectTrigger>
          <SelectContent>
            {stockPoints.map((sp) => (
              <SelectItem key={sp.id} value={sp.id}>
                {sp.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="transfer-quantity">
          Quantity
        </label>
        <Input id="transfer-quantity" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="transfer-notes">
          Notes (optional)
        </label>
        <Input id="transfer-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {formError && <p className="form-error">{formError}</p>}
      <div className="action-row">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Transfer'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
