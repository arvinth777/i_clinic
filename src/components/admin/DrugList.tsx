import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatPaise, formatPaiseForInput, parseRupeesToPaise } from '../../lib/money'
import { Drawer } from '../Drawer'

type Medicine = {
  id: string
  name: string
  price_paise: number
  drug_type: string | null
  strength_options: string[] | null
  low_stock_threshold: number | null
  expiry_date: string | null
}

const DRUG_TYPES = ['Tablet', 'Syrup', 'Capsule', 'Powder', 'Injection', 'Other'] as const

type Draft = {
  name: string
  price: string
  drug_type: string
  strength_options: string
  low_stock_threshold: string
  expiry_date: string
}

const emptyDraft: Draft = { name: '', price: '', drug_type: '', strength_options: '', low_stock_threshold: '', expiry_date: '' }

function toDraft(m: Medicine): Draft {
  return {
    name: m.name,
    price: formatPaiseForInput(m.price_paise),
    drug_type: m.drug_type ?? '',
    strength_options: (m.strength_options ?? []).join(', '),
    low_stock_threshold: m.low_stock_threshold != null ? String(m.low_stock_threshold) : '',
    expiry_date: m.expiry_date ?? '',
  }
}

// Removal is a real DELETE, not a soft-delete flag -- medicines referenced
// by a prescription or a bill are protected by a NO ACTION foreign key and
// the database itself refuses the delete (caught below, shown plainly).
export function DrugList({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['admin-medicines', clinicId]
  const { data: medicines } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('medicines')
        .select('id, name, price_paise, drug_type, strength_options, low_stock_threshold, expiry_date')
        .eq('clinic_id', clinicId)
        .order('name')
      if (error) throw error
      return data as Medicine[]
    },
  })

  const [editing, setEditing] = useState<Medicine | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [formError, setFormError] = useState('')
  const [removeError, setRemoveError] = useState('')

  function openNew() {
    setDraft(emptyDraft)
    setFormError('')
    setEditing('new')
  }
  function openEdit(m: Medicine) {
    setDraft(toDraft(m))
    setFormError('')
    setEditing(m)
  }

  const save = useMutation({
    mutationFn: async () => {
      const price = parseRupeesToPaise(draft.price)
      if (price === null) throw new Error("Enter a valid price")
      const row = {
        clinic_id: clinicId,
        name: draft.name.trim(),
        price_paise: price,
        drug_type: draft.drug_type || null,
        strength_options: draft.strength_options.trim()
          ? draft.strength_options.split(',').map((s) => s.trim()).filter(Boolean)
          : null,
        low_stock_threshold: draft.low_stock_threshold.trim() === '' ? null : Number(draft.low_stock_threshold),
        expiry_date: draft.expiry_date || null,
      }
      const { error } = editing === 'new'
        ? await supabase.from('medicines').insert(row)
        : await supabase.from('medicines').update(row).eq('id', (editing as Medicine).id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setEditing(null)
    },
    onError: (e: Error) => setFormError(e.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('medicines').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setRemoveError('')
    },
    onError: () => setRemoveError("Couldn't remove — it's already used in a prescription, bill, or stock record."),
  })

  return (
    <div>
      <div className="admin-toolbar">
        <h2 className="readout-heading">Drugs</h2>
        <button type="button" className="primary-button" onClick={openNew}>
          + Add drug
        </button>
      </div>
      {removeError && <p className="form-error">{removeError}</p>}
      <div className="worklist-scroll">
        <table className="worklist">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Price</th>
              <th>Low stock at</th>
              <th>Expiry</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(medicines ?? []).map((m) => (
              <tr key={m.id} className="worklist-row worklist-row-clickable" onClick={() => openEdit(m)}>
                <td className="worklist-name-cell">{m.name}</td>
                <td>{m.drug_type ?? '—'}</td>
                <td className="worklist-wait-cell">{formatPaise(m.price_paise)}</td>
                <td className="worklist-wait-cell">{m.low_stock_threshold ?? '—'}</td>
                <td>{m.expiry_date ?? '—'}</td>
                <td>
                  <button
                    type="button"
                    className="drug-row-remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Remove ${m.name}?`)) remove.mutate(m.id)
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Drawer open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add drug' : (editing as Medicine | null)?.name ?? ''}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="drug-name">
              Name
            </label>
            <input id="drug-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} required autoFocus />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="drug-type">
              Type
            </label>
            <select id="drug-type" value={draft.drug_type} onChange={(e) => setDraft((d) => ({ ...d, drug_type: e.target.value }))}>
              <option value="">—</option>
              {DRUG_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="drug-strengths">
              Strength options (comma-separated)
            </label>
            <input
              id="drug-strengths"
              value={draft.strength_options}
              onChange={(e) => setDraft((d) => ({ ...d, strength_options: e.target.value }))}
              placeholder="250mg, 500mg"
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="drug-price">
              Price (₹)
            </label>
            <input id="drug-price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="drug-threshold">
              Low-stock threshold
            </label>
            <input
              id="drug-threshold"
              type="number"
              min="0"
              value={draft.low_stock_threshold}
              onChange={(e) => setDraft((d) => ({ ...d, low_stock_threshold: e.target.value }))}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="drug-expiry">
              Expiry date
            </label>
            <input id="drug-expiry" type="date" value={draft.expiry_date} onChange={(e) => setDraft((d) => ({ ...d, expiry_date: e.target.value }))} />
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
    </div>
  )
}
