import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { parseRupeesToPaise } from '../../lib/money'

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
        <select id="purchase-supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required autoFocus>
          <option value="">— Choose —</option>
          {(suppliers ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {(suppliers ?? []).length === 0 && <p className="field-hint">No suppliers yet — add one under the Suppliers tab first.</p>}
      </div>
      <div className="field">
        <label className="field-label" htmlFor="purchase-invoice">
          Invoice number
        </label>
        <input id="purchase-invoice" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="purchase-date">
          Date
        </label>
        <input id="purchase-date" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} required />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="purchase-stock-point">
          Stock point
        </label>
        <select id="purchase-stock-point" value={stockPointId} onChange={(e) => setStockPointId(e.target.value)} required>
          <option value="">— Choose —</option>
          {stockPoints.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <span className="field-label">Drugs received</span>
        {items.map((item, i) => (
          <div key={i} className="action-row">
            <select value={item.medicine_id} onChange={(e) => updateItem(i, { medicine_id: e.target.value })} required>
              <option value="">— Drug —</option>
              {medicines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="1"
              placeholder="Qty"
              value={item.quantity}
              onChange={(e) => updateItem(i, { quantity: e.target.value })}
              required
            />
            <input
              inputMode="decimal"
              placeholder="Cost price (₹)"
              value={item.cost_price}
              onChange={(e) => updateItem(i, { cost_price: e.target.value })}
              required
            />
            {items.length > 1 && (
              <button type="button" className="secondary-button" onClick={() => setItems((rows) => rows.filter((_, idx) => idx !== i))}>
                Remove
              </button>
            )}
          </div>
        ))}
        <button type="button" className="secondary-button" onClick={() => setItems((rows) => [...rows, emptyItem])}>
          + Add another drug
        </button>
      </div>

      {formError && <p className="form-error">{formError}</p>}
      <div className="action-row">
        <button type="submit" className="primary-button" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save purchase'}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
