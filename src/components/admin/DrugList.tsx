import { useRef, useState } from 'react'
import { SaveTick } from '../SaveTick'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { attemptOrQueue, setMedicineUnitPrice } from '../../lib/offlineQueue'
import { supabase } from '../../lib/supabase'
import { formatPaise, formatPaiseForInput, parseRupeesToPaise } from '../../lib/money'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { useConfirm } from '../../lib/confirm'

type Medicine = {
  id: string
  name: string
  molecule_name: string | null
  price_paise: number
  drug_type: string | null
  strength_options: string[] | null
  low_stock_threshold: number | null
  expiry_date: string | null
  stock_unit: string | null
  unit_confirmed_at: string | null
}

const DRUG_TYPES = ['Tablet', 'Syrup', 'Capsule', 'Powder', 'Injection', 'Other'] as const
// Radix Select.Item can't take value="" (it throws) -- this sentinel stands in
// for the old native <option value="">—</option>, so a drug's type can still
// be explicitly cleared back to blank, not just left unset on creation.
const DRUG_TYPE_UNSET = '__unset__'

type Draft = {
  name: string
  molecule_name: string
  price: string
  drug_type: string
  strength_options: string
  low_stock_threshold: string
  expiry_date: string
  stock_unit: string
}

const emptyDraft: Draft = { name: '', molecule_name: '', price: '', drug_type: '', strength_options: '', low_stock_threshold: '', expiry_date: '', stock_unit: '' }

function toDraft(m: Medicine): Draft {
  return {
    name: m.name,
    molecule_name: m.molecule_name ?? '',
    price: formatPaiseForInput(m.price_paise),
    drug_type: m.drug_type ?? '',
    strength_options: (m.strength_options ?? []).join(', '),
    low_stock_threshold: m.low_stock_threshold != null ? String(m.low_stock_threshold) : '',
    expiry_date: m.expiry_date ?? '',
    stock_unit: m.stock_unit ?? '',
  }
}

// Retirement hides a medicine from new work without erasing clinical or stock history.
export function DrugList({ clinicId, pricesOnly = false }: { clinicId: string; pricesOnly?: boolean }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const newMedicineId = useRef<string | null>(null)
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(50)
  const queryKey = ['admin-medicines', clinicId]
  const { data: medicines } = useQuery({
    queryKey: [...queryKey, search, limit],
    queryFn: async () => {
      let query = supabase
        .from('medicines')
        .select('id, name, molecule_name, price_paise, drug_type, strength_options, low_stock_threshold, expiry_date, stock_unit, unit_confirmed_at')
        .eq('clinic_id', clinicId)
        .eq('is_active', true)
        .order('name')
        .limit(limit + 1)
      if (search.trim()) query = query.ilike('name', `%${search.trim()}%`)
      const { data, error } = await query
      if (error) throw error
      return data as Medicine[]
    },
  })

  const [editing, setEditing] = useState<Medicine | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [formError, setFormError] = useState('')
  const [removeError, setRemoveError] = useState('')
  const [countsConfirmed, setCountsConfirmed] = useState(false)
  const { data: counts } = useQuery({
    queryKey: ['unit-counts', editing && editing !== 'new' ? editing.id : null],
    enabled: pricesOnly && !!editing && editing !== 'new',
    queryFn: async () => {
      const { data, error } = await supabase.from('medicine_stock').select('quantity, stock_points(name)').eq('clinic_id', clinicId).eq('medicine_id', (editing as Medicine).id)
      if (error) throw error
      return data as unknown as { quantity: number; stock_points: { name: string } }[]
    },
  })

  function openNew() {
    newMedicineId.current = null
    setDraft(emptyDraft)
    setFormError('')
    setEditing('new')
  }
  function openEdit(m: Medicine) {
    setDraft(toDraft(m))
    setCountsConfirmed(false)
    setFormError('')
    setEditing(m)
  }

  const save = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      const price = parseRupeesToPaise(draft.price)
      if (price === null) throw new Error("Enter a valid price")
      if (pricesOnly) {
        if (editing === 'new') {
          if (!draft.name.trim() || !draft.molecule_name.trim() || !draft.strength_options.trim() || !draft.stock_unit.trim()) throw new Error('Enter product name, molecule, strength and billing unit')
          const id = newMedicineId.current ??= crypto.randomUUID()
          const row = { id, clinic_id: clinicId, name: draft.name.trim(), molecule_name: draft.molecule_name.trim(), strength_options: draft.strength_options.split(',').map(s => s.trim()).filter(Boolean), drug_type: draft.drug_type || null, low_stock_threshold: draft.low_stock_threshold.trim() ? Number(draft.low_stock_threshold) : null, expiry_date: draft.expiry_date || null, price_paise: 0 }
          await attemptOrQueue({ clinicId,
            attempt: token => supabase.from('medicines').upsert(row, { onConflict: 'id', ignoreDuplicates: true }).setHeader('Authorization', `Bearer ${token}`),
            queueItem: () => ({ kind: 'insert', table: 'medicines', payload: row, description: `Add medicine "${row.name}"` }),
          })
          await setMedicineUnitPrice(clinicId, { p_medicine_id: id, p_stock_unit: draft.stock_unit.trim(), p_price_paise: price }, 'Confirm new medicine unit and price')
          return
        }
        if (editing === null) throw new Error('Choose a medicine')
        if (!editing.unit_confirmed_at && (!counts || !countsConfirmed)) throw new Error('Confirm the existing stock counts and unit price first')
        const metadata = { name: draft.name.trim(), molecule_name: draft.molecule_name.trim() || null, strength_options: draft.strength_options.trim() ? draft.strength_options.split(',').map(s => s.trim()).filter(Boolean) : null, drug_type: draft.drug_type || null, low_stock_threshold: draft.low_stock_threshold.trim() ? Number(draft.low_stock_threshold) : null, expiry_date: draft.expiry_date || null }
        await attemptOrQueue({ clinicId,
          attempt: token => supabase.from('medicines').update(metadata).eq('id', editing.id).setHeader('Authorization', `Bearer ${token}`),
          queueItem: () => ({ kind: 'update', table: 'medicines', match: { id: editing.id }, payload: metadata, description: 'Update medicine catalog details' }),
        })
        const payload = { p_medicine_id: editing.id, p_stock_unit: draft.stock_unit.trim(), p_price_paise: price }
        await setMedicineUnitPrice(clinicId, payload, 'Set medicine unit and price')
        return
      }
      const row = {
        clinic_id: clinicId,
        name: draft.name.trim(),
        molecule_name: draft.molecule_name.trim() || null,
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
      queryClient.invalidateQueries()
      newMedicineId.current = null
      setEditing(null)
    },
    onError: (e: Error) => setFormError(e.message),
  })

  const remove = useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      const args = { p_medicine_id: id }
      await attemptOrQueue({ clinicId,
        attempt: token => supabase.rpc('retire_medicine', args).setHeader('Authorization', `Bearer ${token}`),
        queueItem: () => ({ kind: 'rpc', rpc: 'retire_medicine', payload: args, description: 'Retire medicine' }),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setRemoveError('')
    },
    onError: () => setRemoveError("Couldn't remove this medicine. Check your connection and try again."),
  })

  if (editing !== null) {
    return (
      <div>
        <button type="button" className="back-to-queue" onClick={() => setEditing(null)}>
          ← Back to drugs
        </button>
        <h2 className="readout-heading">{editing === 'new' ? 'Add drug' : (editing as Medicine).name}</h2>
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
          <label className="field"><span className="field-label">Molecule / generic name</span><Input value={draft.molecule_name} onChange={e => setDraft(d => ({ ...d, molecule_name: e.target.value }))} placeholder="e.g. Paracetamol" required={editing === 'new' && pricesOnly} /></label>
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
          {pricesOnly && <>
            <div className="field">
              <label className="field-label" htmlFor="drug-unit">Billing and stock unit</label>
              <Input id="drug-unit" value={draft.stock_unit} maxLength={24} placeholder="tablet, strip, bottle…" required disabled={editing !== 'new' && !!editing.unit_confirmed_at} onChange={(e) => setDraft((d) => ({ ...d, stock_unit: e.target.value }))} />
            </div>
            {editing !== 'new' && !editing.unit_confirmed_at && <div className="field">
              <p>{counts ? (counts.length ? counts.map((c) => `${c.stock_points.name}: ${c.quantity}`).join(' · ') : 'No recorded stock') : 'Loading existing stock…'}</p>
              <label><input type="checkbox" checked={countsConfirmed} disabled={!counts} onChange={(e) => setCountsConfirmed(e.target.checked)} required /> Existing counts and price use this unit. No counts will be converted.</label>
            </div>}
          </>}
          <div className="field">
            <label className="field-label" htmlFor="drug-price">
              {pricesOnly ? 'Price per unit (₹)' : 'Price (₹)—confirm the unit under Stock before billing'}
            </label>
            <Input id="drug-price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} required />
          </div>
          <>
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
          </>
          {formError && <p className="form-error">{formError}</p>}
          <div className="action-row">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
            <SaveTick mutation={save} />
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div>
      <div className="admin-toolbar">
        <h2 className="readout-heading">{pricesOnly ? 'Medicine units and prices' : 'Drugs'}</h2>
        <Button type="button" variant="secondary" onClick={openNew}>Add drug</Button>
      </div>
      <Input aria-label="Find medicine" placeholder="Find a medicine to edit or remove" value={search} onChange={e => { setSearch(e.target.value); setLimit(50) }} />
      {removeError && <p className="form-error">{removeError}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Unit price</TableHead>
            <TableHead>Low stock at</TableHead>
            <TableHead>Expiry</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(medicines ?? []).slice(0, limit).map((m) => (
            <TableRow key={m.id} className="worklist-row-clickable" onClick={() => openEdit(m)}>
              <TableCell className="worklist-name-cell">{m.name}</TableCell>
              <TableCell>{m.drug_type ?? '—'}</TableCell>
              <TableCell className="worklist-wait-cell">{formatPaise(m.price_paise)} / {m.stock_unit ?? 'unit not confirmed'}</TableCell>
              <TableCell className="worklist-wait-cell">{m.low_stock_threshold ?? '—'}</TableCell>
              <TableCell>{m.expiry_date ?? '—'}</TableCell>
              <TableCell>
                {pricesOnly && <Button type="button" variant="secondary" onClick={(e) => { e.stopPropagation(); openEdit(m) }}>{m.unit_confirmed_at ? 'Edit price' : 'Confirm unit'}</Button>} <button
                  type="button"
                  className="drug-row-remove"
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (await confirm({ title: `Remove ${m.name}?`, body: 'It will no longer be available for new prescriptions or sales. Past bills and stock records remain.', confirmLabel: 'Remove' })) remove.mutate(m.id)
                  }}
                >
                  Remove
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {(medicines?.length ?? 0) > limit && <Button type="button" variant="secondary" onClick={() => setLimit(value => value + 50)}>Show more</Button>}
    </div>
  )
}
