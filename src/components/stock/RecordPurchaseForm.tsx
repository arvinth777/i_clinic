import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { parseRupeesToPaise } from '../../lib/money'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

type Medicine = { id: string; name: string }
type StockPoint = { id: string; name: string }
type Supplier = { id: string; name: string }
type ItemDraft = { medicine_id: string; quantity: string; cost_price: string }

const emptyItem: ItemDraft = { medicine_id: '', quantity: '', cost_price: '' }

export function RecordPurchaseForm({
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
  const { data: suppliers } = useQuery({
    queryKey: ['suppliers', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('id, name').eq('clinic_id', clinicId).order('name')
      if (error) throw error
      return data as Supplier[]
    },
  })

  const [supplierId, setSupplierId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [stockPointId, setStockPointId] = useState('')
  const [items, setItems] = useState<ItemDraft[]>([emptyItem])
  const [formError, setFormError] = useState('')

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!supplierId) throw new Error('Choose a supplier')
      if (!stockPointId) throw new Error('Choose a stock point')
      const parsedItems = items
        .filter((it) => it.medicine_id)
        .map((it) => {
          const quantity = Number(it.quantity)
          const costPaise = parseRupeesToPaise(it.cost_price)
          if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('Enter a valid quantity for every drug')
          if (costPaise === null) throw new Error('Enter a valid cost price for every drug')
          return { medicine_id: it.medicine_id, quantity, cost_price_paise: costPaise }
        })
      if (parsedItems.length === 0) throw new Error('Add at least one drug')

      const { error } = await supabase.rpc('record_purchase', {
        p_clinic_id: clinicId,
        p_supplier_id: supplierId,
        p_invoice_number: invoiceNumber.trim(),
        p_purchase_date: purchaseDate,
        p_stock_point_id: stockPointId,
        p_items: parsedItems,
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
        <label className="field-label" htmlFor="purchase-supplier">
          Supplier
        </label>
        <Select value={supplierId} onValueChange={setSupplierId}>
          <SelectTrigger id="purchase-supplier" autoFocus>
            <SelectValue placeholder="— Choose —" />
          </SelectTrigger>
          <SelectContent>
            {(suppliers ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(suppliers ?? []).length === 0 && <p className="field-hint">No suppliers yet — add one under the Suppliers tab first.</p>}
      </div>
      <div className="field">
        <label className="field-label" htmlFor="purchase-invoice">
          Invoice number
        </label>
        <Input id="purchase-invoice" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="purchase-date">
          Date
        </label>
        <Input id="purchase-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="purchase-stock-point">
          Stock point
        </label>
        <Select value={stockPointId} onValueChange={setStockPointId}>
          <SelectTrigger id="purchase-stock-point">
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
        <span className="field-label">Drugs received</span>
        {items.map((item, i) => (
          <div key={i} className="action-row">
            <Select value={item.medicine_id} onValueChange={(v) => updateItem(i, { medicine_id: v })}>
              <SelectTrigger>
                <SelectValue placeholder="— Drug —" />
              </SelectTrigger>
              <SelectContent>
                {medicines.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              min="1"
              placeholder="Qty"
              value={item.quantity}
              onChange={(e) => updateItem(i, { quantity: e.target.value })}
              required
            />
            <Input
              inputMode="decimal"
              placeholder="Cost price (₹)"
              value={item.cost_price}
              onChange={(e) => updateItem(i, { cost_price: e.target.value })}
              required
            />
            {items.length > 1 && (
              <Button type="button" variant="secondary" onClick={() => setItems((rows) => rows.filter((_, idx) => idx !== i))}>
                Remove
              </Button>
            )}
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => setItems((rows) => [...rows, emptyItem])}>
          + Add another drug
        </Button>
      </div>

      {formError && <p className="form-error">{formError}</p>}
      <div className="action-row">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save purchase'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
