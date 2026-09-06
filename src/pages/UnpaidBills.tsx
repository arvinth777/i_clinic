import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatPaise } from '../lib/money'
import { formatDate } from '../lib/date'
import { Drawer } from '../components/Drawer'

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

function SettleForm({ bill, onDone, onCancel }: { bill: UnpaidBill; onDone: () => void; onCancel: () => void }) {
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
        settle.mutate()
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
        <input id="settle-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. paid in person on next visit" />
      </div>
      {formError && <p className="form-error">{formError}</p>}
      <div className="action-row">
        <button type="submit" className="primary-button" disabled={settle.isPending}>
          {settle.isPending ? 'Saving…' : 'Mark settled'}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function UnpaidBills({ clinicId }: { clinicId: string }) {
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

  const [settling, setSettling] = useState<UnpaidBill | null>(null)

  function onSettled() {
    queryClient.invalidateQueries({ queryKey })
    setSettling(null)
  }

  return (
    <div className="admin-page">
      <div className="admin-toolbar">
        <h2 className="readout-heading">Unpaid</h2>
      </div>
      {(bills ?? []).length === 0 ? (
        <p className="readout-empty">Nothing owed right now.</p>
      ) : (
        <div className="worklist-scroll">
          <table className="worklist">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Token</th>
                <th>Billed on</th>
                <th>Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(bills ?? []).map((b) => (
                <tr key={b.bill_id} className="worklist-row">
                  <td className="worklist-name-cell">{b.patient_name}</td>
                  <td className="worklist-wait-cell">{b.token_number}</td>
                  <td className="worklist-wait-cell">{formatDate(b.confirmed_at)}</td>
                  <td className="worklist-wait-cell">{formatPaise(b.final_amount_paise)}</td>
                  <td>
                    <button type="button" className="secondary-button" onClick={() => setSettling(b)}>
                      Settle
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer open={!!settling} onClose={() => setSettling(null)} title="Settle bill">
        {settling && <SettleForm bill={settling} onDone={onSettled} onCancel={() => setSettling(null)} />}
      </Drawer>
    </div>
  )
}
