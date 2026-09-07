import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatPaise, formatPaiseForInput, parseRupeesToPaise } from '../../lib/money'
import { Drawer } from '../Drawer'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

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
// Radix Select.Item can't take value="" (it throws) -- this sentinel stands in
// for the old native <option value="">—</option>, so a drug's type can still
// be explicitly cleared back to blank, not just left unset on creation.
const DRUG_TYPE_UNSET = '__unset__'

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
        <Button type="button" onClick={openNew}>
          + Add drug
        </Button>
      </div>
      {removeError && <p className="form-error">{removeError}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>Low stock at</TableHead>
            <TableHead>Expiry</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(medicines ?? []).map((m) => (
            <TableRow key={m.id} className="worklist-row-clickable" onClick={() => openEdit(m)}>
              <TableCell className="worklist-name-cell">{m.name}</TableCell>
              <TableCell>{m.drug_type ?? '—'}</TableCell>
              <TableCell className="worklist-wait-cell">{formatPaise(m.price_paise)}</TableCell>
              <TableCell className="worklist-wait-cell">{m.low_stock_threshold ?? '—'}</TableCell>
              <TableCell>{m.expiry_date ?? '—'}</TableCell>
              <TableCell>
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

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
            <Input id="drug-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} required autoFocus />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="drug-type">
              Type
            </label>
            <Select
              value={draft.drug_type || DRUG_TYPE_UNSET}
              onValueChange={(v) => setDraft((d) => ({ ...d, drug_type: v === DRUG_TYPE_UNSET ? '' : v }))}
            >
              <SelectTrigger id="drug-type">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DRUG_TYPE_UNSET}>—</SelectItem>
                {DRUG_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="drug-strengths">
              Strength options (comma-separated)
            </label>
            <Input
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
            <Input id="drug-price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="drug-threshold">
              Low-stock threshold
            </label>
            <Input
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
            <Input id="drug-expiry" type="date" value={draft.expiry_date} onChange={(e) => setDraft((d) => ({ ...d, expiry_date: e.target.value }))} />
          </div>
          {formError && <p className="form-error">{formError}</p>}
          <div className="action-row">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  )
}
