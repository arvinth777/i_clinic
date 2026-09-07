import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Drawer } from '../Drawer'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

type Template = { id: string; name: string; prescription_template_items: { medicine_id: string }[] }

// Management only -- the doctor is still the only one who creates a
// template, from the consultation screen (prescription_templates_insert
// stays doctor-only). Admin can view, rename, and delete.
export function TemplateList({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['admin-templates', clinicId]
  const { data: templates } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('prescription_templates')
        .select('id, name, prescription_template_items(medicine_id)')
        .eq('clinic_id', clinicId)
        .order('name')
      if (error) throw error
      return data as unknown as Template[]
    },
  })

  const [renaming, setRenaming] = useState<Template | null>(null)
  const [name, setName] = useState('')
  const [formError, setFormError] = useState('')

  const rename = useMutation({
    mutationFn: async () => {
      if (!renaming) return
      const { error } = await supabase.from('prescription_templates').update({ name: name.trim() }).eq('id', renaming.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setRenaming(null)
    },
    onError: (e: Error) => setFormError(e.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('prescription_templates').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  return (
    <div>
      <div className="admin-toolbar">
        <h2 className="readout-heading">Prescription templates</h2>
      </div>
      <p className="readout-empty">Doctors create these from the consultation screen. Here you can rename or remove one.</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Drugs</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(templates ?? []).map((t) => (
            <TableRow
              key={t.id}
              className="worklist-row-clickable"
              onClick={() => {
                setName(t.name)
                setFormError('')
                setRenaming(t)
              }}
            >
              <TableCell className="worklist-name-cell">{t.name}</TableCell>
              <TableCell className="worklist-wait-cell">{t.prescription_template_items?.length ?? 0}</TableCell>
              <TableCell>
                <button
                  type="button"
                  className="drug-row-remove"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Remove template "${t.name}"?`)) remove.mutate(t.id)
                  }}
                >
                  Remove
                </button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Drawer open={renaming !== null} onClose={() => setRenaming(null)} title="Rename template">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            rename.mutate()
          }}
        >
          <div className="field">
            <label className="field-label" htmlFor="template-name">
              Name
            </label>
            <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          {formError && <p className="form-error">{formError}</p>}
          <div className="action-row">
            <Button type="submit" disabled={rename.isPending}>
              {rename.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  )
}
