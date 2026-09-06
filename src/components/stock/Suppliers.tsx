import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatPaise } from '../../lib/money'
import { Drawer } from '../Drawer'

type Supplier = { id: string; name: string; phone: string | null; address: string | null }
type PurchaseHistoryRow = {
  id: string
  invoice_number: string
  purchase_date: string
  stock_point_name: string
  items: { medicine_name: string; quantity: number; cost_price_paise: number }[]
}

export function Suppliers({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['suppliers', clinicId]
  const { data: suppliers } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('id, name, phone, address').eq('clinic_id', clinicId).order('name')
      if (error) throw error
      return data as Supplier[]
    },
  })

  const [editing, setEditing] = useState<'new' | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [formError, setFormError] = useState('')
  const [historyFor, setHistoryFor] = useState<Supplier | null>(null)

  function openNew() {
    setName('')
    setPhone('')
    setAddress('')
    setFormError('')
    setEditing('new')
  }

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('suppliers').insert({
        clinic_id: clinicId,
        name: name.trim(),
        phone: phone.trim() || null,
        address: address.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setEditing(null)
    },
    onError: (e: Error) => setFormError(e.message),
  })

  const { data: history } = useQuery({
    queryKey: ['supplier-purchase-history', historyFor?.id],
    enabled: !!historyFor,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchases')
        .select('id, invoice_number, purchase_date, stock_points(name), purchase_items(quantity, cost_price_paise, medicines(name))')
        .eq('supplier_id', historyFor!.id)
        .order('purchase_date', { ascending: false })
      if (error) throw error
      return (data as unknown as {
        id: string
        invoice_number: string
        purchase_date: string
        stock_points: { name: string } | null
        purchase_items: { quantity: number; cost_price_paise: number; medicines: { name: string } | null }[]
      }[]).map((p) => ({
        id: p.id,
        invoice_number: p.invoice_number,
        purchase_date: p.purchase_date,
        stock_point_name: p.stock_points?.name ?? '—',
        items: p.purchase_items.map((it) => ({ medicine_name: it.medicines?.name ?? '—', quantity: it.quantity, cost_price_paise: it.cost_price_paise })),
      })) as PurchaseHistoryRow[]
    },
  })

  return (
    <div>
      <div className="admin-toolbar">
        <h2 className="readout-heading">Suppliers</h2>
        <button type="button" className="primary-button" onClick={openNew}>
          + Add supplier
        </button>
      </div>
      <div className="worklist-scroll">
        <table className="worklist">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(suppliers ?? []).map((s) => (
              <tr key={s.id} className="worklist-row worklist-row-clickable" onClick={() => setHistoryFor(s)}>
                <td className="worklist-name-cell">{s.name}</td>
                <td>{s.phone ?? '—'}</td>
                <td>
                  <button type="button" className="secondary-button" onClick={(e) => { e.stopPropagation(); setHistoryFor(s) }}>
                    Purchase history
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer open={editing === 'new'} onClose={() => setEditing(null)} title="Add supplier">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="supplier-name">
              Name
            </label>
            <input id="supplier-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="supplier-phone">
              Phone
            </label>
            <input id="supplier-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="supplier-address">
              Address
            </label>
            <input id="supplier-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          {formError && <p className="form-error">{formError}</p>}
          <div className="action-row">
            <button type="submit" className="primary-button" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="secondary-button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      </Drawer>

      <Drawer open={!!historyFor} onClose={() => setHistoryFor(null)} title={historyFor ? `${historyFor.name} — purchase history` : ''}>
        {(history ?? []).length === 0 && <p className="field-hint">No purchases recorded yet.</p>}
        {(history ?? []).map((p) => (
          <div key={p.id} className="field">
            <div className="field-label">
              {p.purchase_date} — Invoice {p.invoice_number} — {p.stock_point_name}
            </div>
            <table className="worklist">
              <tbody>
                {p.items.map((it, i) => (
                  <tr key={i} className="worklist-row">
                    <td className="worklist-name-cell">{it.medicine_name}</td>
                    <td className="worklist-wait-cell">×{it.quantity}</td>
                    <td className="worklist-wait-cell">{formatPaise(it.cost_price_paise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </Drawer>
    </div>
  )
}
