import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Drawer } from '../Drawer'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

type FieldDef = { id: string; key: string; label: string; field_type: string; display_order: number }

const FIELD_TYPES = ['text', 'number', 'date', 'boolean'] as const

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Adding a field here is an INSERT, never a migration -- the key is the
// slot in patients.custom_fields (jsonb) this definition governs; renaming
// the label later doesn't move the underlying data.
export function CustomFieldList({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['admin-field-definitions', clinicId]
  const { data: fields } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patient_field_definitions')
        .select('id, key, label, field_type, display_order')
        .eq('clinic_id', clinicId)
        .order('display_order')
      if (error) throw error
      return data as FieldDef[]
    },
  })

  const [editing, setEditing] = useState<FieldDef | 'new' | null>(null)
  const [label, setLabel] = useState('')
  const [fieldType, setFieldType] = useState<(typeof FIELD_TYPES)[number]>('text')
  const [displayOrder, setDisplayOrder] = useState('0')
  const [formError, setFormError] = useState('')

  function openNew() {
    setLabel('')
    setFieldType('text')
    setDisplayOrder(String((fields?.length ?? 0) + 1))
    setFormError('')
    setEditing('new')
  }
  function openEdit(f: FieldDef) {
    setLabel(f.label)
    setFieldType(f.field_type as (typeof FIELD_TYPES)[number])
    setDisplayOrder(String(f.display_order))
    setFormError('')
    setEditing(f)
  }

  const save = useMutation({
    mutationFn: async () => {
      const order = Number(displayOrder)
      if (editing === 'new') {
        const { error } = await supabase.from('patient_field_definitions').insert({
          clinic_id: clinicId,
          key: slugify(label),
          label: label.trim(),
          field_type: fieldType,
          display_order: order,
        })
        if (error) throw error
      } else if (editing) {
        // The key (the JSONB slot) never changes on edit -- only how it's
        // labelled/typed/ordered. Changing it would orphan every existing
        // patient's stored value for this field.
        const { error } = await supabase
          .from('patient_field_definitions')
          .update({ label: label.trim(), field_type: fieldType, display_order: order })
          .eq('id', editing.id)
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setEditing(null)
    },
    onError: (e: Error) => setFormError(e.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('patient_field_definitions').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  return (
    <div>
      <div className="admin-toolbar">
        <h2 className="readout-heading">Custom patient fields</h2>
        <Button type="button" onClick={openNew}>
          + Add field
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Label</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Order</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(fields ?? []).map((f) => (
            <TableRow key={f.id} className="worklist-row-clickable" onClick={() => openEdit(f)}>
              <TableCell className="worklist-name-cell">{f.label}</TableCell>
              <TableCell className="worklist-wait-cell">{f.key}</TableCell>
              <TableCell>{f.field_type}</TableCell>
              <TableCell className="worklist-wait-cell">{f.display_order}</TableCell>
              <TableCell>
                <button
                  type="button"
                  className="drug-row-remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Remove the "${f.label}" field? Existing patient values for it are kept but no longer shown.`)) remove.mutate(f.id)
                  }}
                >
                  Remove
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Drawer open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add custom field' : (editing as FieldDef | null)?.label ?? ''}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="field-label">
              Label
            </label>
            <Input id="field-label" value={label} onChange={(e) => setLabel(e.target.value)} required autoFocus placeholder="e.g. Pain score (0-10)" />
          </div>
          {editing === 'new' && label.trim() && <p className="readout-empty">Stored as: {slugify(label)}</p>}
          <div className="field">
            <label className="field-label" htmlFor="field-type">
              Type
            </label>
            <Select value={fieldType} onValueChange={(v) => setFieldType(v as (typeof FIELD_TYPES)[number])}>
              <SelectTrigger id="field-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="field-order">
              Display order
            </label>
            <Input id="field-order" type="number" value={displayOrder} onChange={(e) => setDisplayOrder(e.target.value)} />
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
