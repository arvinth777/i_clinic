import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatPaise } from '../lib/money'
import { formatDate } from '../lib/date'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { QueryError } from '../components/QueryState'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'

type UnpaidBill = {
  bill_id: string
  visit_id: string
  final_amount_paise: number
  confirmed_at: string
  token_number: number
  arrived_at: string
  patient_name: string
}

const SETTLE_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
] as const

function SettleForm({ bill, onDone, onCancel, validating }: { bill: UnpaidBill; onDone: () => void; onCancel: () => void; validating: boolean }) {
  const [paymentMethod, setPaymentMethod] = useState<(typeof SETTLE_METHODS)[number]['value']>('cash')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')

  const settle = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('settle_bill', { p_bill_id: bill.bill_id, p_payment_method: paymentMethod, p_notes: notes.trim() || null })
      if (error) throw error
    },
    onSuccess: onDone,
    onError: (e: Error) => setFormError(e.message),
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!validating) settle.mutate()
      }}
    >
      <p className="readout-empty">
        {bill.patient_name} — Token {bill.token_number} — {formatPaise(bill.final_amount_paise)} owed since {formatDate(bill.confirmed_at)}
      </p>
      <div className="field">
        <span className="field-label">Paid via</span>
        <div className="payment-method-row">
          {SETTLE_METHODS.map((m) => (
            <label key={m.value} className="payment-method-option">
              <input type="radio" name="settle-method" value={m.value} checked={paymentMethod === m.value} onChange={() => setPaymentMethod(m.value)} />
              {m.label}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="settle-notes">
          Notes (optional)
        </label>
        <Input id="settle-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. paid in person on next visit" />
      </div>
      {formError && <p className="form-error">{formError}</p>}
      <div className="action-row">
        <Button type="submit" disabled={settle.isPending || validating}>
          {settle.isPending ? 'Saving…' : 'Mark settled'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function UnpaidBills({ clinicId, initialBillId }: { clinicId: string; initialBillId?: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['unpaid-bills', clinicId]
  const { data: bills } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('unpaid_bills')
        .select('bill_id, visit_id, final_amount_paise, confirmed_at, token_number, arrived_at, patient_name')
        .eq('clinic_id', clinicId)
        .order('confirmed_at', { ascending: true })
      if (error) throw error
      return data as UnpaidBill[]
    },
  })

  const [openedAt] = useState(Date.now)
  const [settlingId, setSettlingId] = useState<string | null>(initialBillId ?? null)
  const target = useQuery({ queryKey: ['unpaid-bill-target', clinicId, settlingId], enabled: !!settlingId, staleTime: 0, refetchOnMount: 'always', queryFn: async () => {
    const { data, error } = await supabase.from('unpaid_bills').select('bill_id,visit_id,final_amount_paise,confirmed_at,token_number,arrived_at,patient_name').eq('clinic_id', clinicId).eq('bill_id', settlingId!).maybeSingle()
    if (error) throw error
    return data as UnpaidBill | null
  } })
  const settling = target.dataUpdatedAt >= openedAt ? target.data ?? null : null

  function onSettled() {
    queryClient.invalidateQueries({ queryKey })
    setSettlingId(null)
  }

  if (settling !== null) {
    return (
      <div className="admin-page">
        <button type="button" className="back-to-queue" onClick={() => setSettlingId(null)}>
          ← Back to unpaid bills
        </button>
        <h2 className="readout-heading">Settle bill</h2>
        {target.isError && <QueryError retry={() => void target.refetch()} savedAt={target.dataUpdatedAt} />}
        <SettleForm bill={settling} validating={target.isFetching || target.isError} onDone={onSettled} onCancel={() => setSettlingId(null)} />
      </div>
    )
  }

  return (
    <div className="admin-page">
      {target.isError && <QueryError retry={() => void target.refetch()} />}
      <div className="admin-toolbar">
        <h2 className="readout-heading">Unpaid</h2>
      </div>
      {(bills ?? []).length === 0 ? (
        <p className="readout-empty">Nothing owed right now.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Billed on</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(bills ?? []).map((b) => (
              <TableRow key={b.bill_id}>
                <TableCell className="worklist-name-cell">{b.patient_name}</TableCell>
                <TableCell className="worklist-wait-cell">{b.token_number}</TableCell>
                <TableCell className="worklist-wait-cell">{formatDate(b.confirmed_at)}</TableCell>
                <TableCell className="worklist-wait-cell">{formatPaise(b.final_amount_paise)}</TableCell>
                <TableCell>
                  <Button type="button" variant="secondary" onClick={() => setSettlingId(b.bill_id)}>
                    Settle
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
