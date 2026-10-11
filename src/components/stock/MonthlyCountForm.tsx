import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

type Medicine = { id: string; name: string }
type StockPoint = { id: string; name: string }

export function MonthlyCountForm({
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
  const [stockPointId, setStockPointId] = useState('')
  const [counted, setCounted] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')

  const { data: expected } = useQuery({
    queryKey: ['stock-for-count', clinicId, stockPointId],
    enabled: !!stockPointId,
    queryFn: async () => {
      const { data, error } = await supabase.from('medicine_stock').select('medicine_id, quantity').eq('clinic_id', clinicId).eq('stock_point_id', stockPointId)
      if (error) throw error
      return new Map((data as { medicine_id: string; quantity: number }[]).map((r) => [r.medicine_id, r.quantity]))
    },
  })

  function expectedFor(medicineId: string): number {
    return expected?.get(medicineId) ?? 0
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!stockPointId) throw new Error('Choose a stock point')
      const lines = Object.entries(counted)
        .filter(([, v]) => v.trim() !== '')
        .map(([medicine_id, v]) => {
          const counted_quantity = Number(v)
          if (!Number.isInteger(counted_quantity) || counted_quantity < 0) throw new Error('Enter a valid counted quantity')
          return { medicine_id, counted_quantity }
        })
      if (lines.length === 0) throw new Error('Enter at least one counted quantity')

      const { error } = await supabase.rpc('record_stock_count', {
        p_clinic_id: clinicId,
        p_stock_point_id: stockPointId,
        p_lines: lines,
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
        <label className="field-label" htmlFor="count-stock-point">
          Stock point
        </label>
        <Select value={stockPointId} onValueChange={setStockPointId}>
          <SelectTrigger id="count-stock-point" autoFocus>
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

      {stockPointId && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Medicine</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Counted</TableHead>
              <TableHead>Gap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {medicines.map((m) => {
              const exp = expectedFor(m.id)
              const enteredRaw = counted[m.id] ?? ''
              const entered = enteredRaw.trim() === '' ? null : Number(enteredRaw)
              const gap = entered === null ? null : entered - exp
              return (
                <TableRow key={m.id}>
                  <TableCell className="worklist-name-cell">{m.name}</TableCell>
                  <TableCell className="worklist-wait-cell">{exp}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      value={enteredRaw}
                      onChange={(e) => setCounted((c) => ({ ...c, [m.id]: e.target.value }))}
                    />
                  </TableCell>
                  <TableCell className={`worklist-wait-cell ${gap != null && gap < 0 ? 'stock-qty-negative' : ''}`}>{gap ?? '—'}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {formError && <p className="form-error">{formError}</p>}
      <div className="action-row">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Confirm count'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
