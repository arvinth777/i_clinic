import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatPaise, formatPaiseForInput, parseRupeesToPaise } from '../../lib/money'
import { Drawer } from '../Drawer'

type Procedure = { id: string; name: string; default_price_paise: number }

export function ProcedureList({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['admin-procedures', clinicId]
  const { data: procedures } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('procedures').select('id, name, default_price_paise').eq('clinic_id', clinicId).order('name')
      if (error) throw error
      return data as Procedure[]
    },
  })

  const [editing, setEditing] = useState<Procedure | 'new' | null>(null)
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [formError, setFormError] = useState('')
  const [removeError, setRemoveError] = useState('')

  function openNew() {
    setName('')
    setPrice('')
    setFormError('')
    setEditing('new')
  }
  function openEdit(p: Procedure) {
    setName(p.name)
    setPrice(formatPaiseForInput(p.default_price_paise))
    setFormError('')
    setEditing(p)
  }

  const save = useMutation({
    mutationFn: async () => {
      const paise = parseRupeesToPaise(price)
      if (paise === null) throw new Error('Enter a valid price')
      const row = { clinic_id: clinicId, name: name.trim(), default_price_paise: paise }
      const { error } = editing === 'new'
        ? await supabase.from('procedures').insert(row)
        : await supabase.from('procedures').update(row).eq('id', (editing as Procedure).id)
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
      const { error } = await supabase.from('procedures').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setRemoveError('')
    },
    onError: () => setRemoveError("Couldn't remove — it's already used on a visit or a bill."),
  })

  return (
    <div>
      <div className="admin-toolbar">
        <h2 className="readout-heading">Procedures</h2>
        <button type="button" className="primary-button" onClick={openNew}>
          + Add procedure
        </button>
      </div>
      {removeError && <p className="form-error">{removeError}</p>}
      <div className="worklist-scroll">
        <table className="worklist">
          <thead>
            <tr>
              <th>Name</th>
              <th>Default price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(procedures ?? []).map((p) => (
              <tr key={p.id} className="worklist-row worklist-row-clickable" onClick={() => openEdit(p)}>
                <td className="worklist-name-cell">{p.name}</td>
                <td className="worklist-wait-cell">{formatPaise(p.default_price_paise)}</td>
                <td>
                  <button
                    type="button"
                    className="drug-row-remove"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Remove ${p.name}?`)) remove.mutate(p.id)
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

      <Drawer open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add procedure' : (editing as Procedure | null)?.name ?? ''}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="proc-name">
              Name
            </label>
            <input id="proc-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="proc-price">
              Default price (₹)
            </label>
            <input id="proc-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required />
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
