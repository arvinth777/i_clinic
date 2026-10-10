import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'motion/react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { formatPaise } from '../lib/money'
import { PrintableSlip, type PrintVisit as Visit, type DetailRow, type Bill } from './VisitPrintout'
import { attemptOrQueue } from '../lib/offlineQueue'
import { Button, buttonVariants } from './ui/button'
import './Billing.css'

type Pricing = { calculated_total_paise: number; final_amount_paise: number; discount_paise: number; revision_number: number; final_amount_set: boolean }

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'pay_later', label: 'Pay later / Credit' },
] as const

function UpiQr({ vpa, amountPaise, payeeName }: { vpa: string; amountPaise: number; payeeName: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    // formatPaise is the same integer-paise-to-rupees formatter used
    // everywhere else in the app -- the UPI URI's amount field is a
    // display string, not an arithmetic value, but it's still built from
    // it (minus the currency glyph) rather than a fresh float division.
    const amount = formatPaise(amountPaise).slice(1)
    const uri = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payeeName)}&am=${amount}&cu=INR`
    let cancelled = false
    QRCode.toDataURL(uri, { margin: 1, width: 220 })
      .then((url) => {
        if (!cancelled) setDataUrl(url)
      })
      .catch(() => setDataUrl(null))
    return () => {
      cancelled = true
    }
  }, [vpa, amountPaise, payeeName])
  if (!dataUrl) return null
  return <img className="upi-qr" src={dataUrl} width={220} height={220} alt="UPI payment QR code" />
}

export function Billing({ clinicId, visitId, onClose }: { clinicId: string; visitId: string; onClose: () => void }) {
  const queryClient = useQueryClient()

  const visitKey = ['billing-visit', visitId]
  const { data: visit } = useQuery({
    queryKey: visitKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, token_number, stage, arrived_at, patients(name)')
        .eq('id', visitId)
        .single()
      if (error) throw error
      return data as unknown as Visit
    },
  })

  // Opening the bill moves the visit to "ready at reception" automatically
  // -- no separate click. Queued offline: patched into the cache directly
  // (not just invalidated -- there's no network to refetch from), so the
  // rest of this screen unblocks immediately instead of waiting on a stage
  // that will only actually change once the queue drains.
  const openBill = useMutation({
    // React Query's default networkMode ('online') pauses a mutation before
    // ever calling mutationFn while navigator.onLine is false -- 'always'
    // is what lets attemptOrQueue's own online/offline branch run at all.
    networkMode: 'always',
    mutationFn: async () => {
      await attemptOrQueue({
        clinicId,
        attempt: (accessToken) => supabase.from('visits').update({ stage: 'ready_at_reception' }).eq('id', visitId).eq('stage', 'packing').setHeader('Authorization', `Bearer ${accessToken}`),
        queueItem: () => ({
          kind: 'update',
          table: 'visits',
          payload: { stage: 'ready_at_reception' },
          match: { id: visitId },
          description: `Open bill for ${visit?.patients?.name ?? 'a visit'}`,
        }),
        applyOptimistic: () => queryClient.setQueryData<Visit>(visitKey, (old) => (old ? { ...old, stage: 'ready_at_reception' } : old)),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: visitKey })
      queryClient.invalidateQueries({ queryKey: ['visits-today', clinicId] })
    },
  })
  useEffect(() => {
    if (visit?.stage === 'packing') openBill.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit?.stage])

  const pricingKey = ['billing-pricing', visitId]
  const { data: pricing } = useQuery({
    queryKey: pricingKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visit_pricing')
        .select('calculated_total_paise, final_amount_paise, discount_paise, revision_number, final_amount_set')
        .eq('visit_id', visitId)
        .single()
      if (error) throw error
      return data as Pricing
    },
  })

  // The doctor can still be editing pricing on his own screen while this
  // panel is open -- Realtime is how this screen finds out (non-negotiable
  // #6: invalidate and refetch, never patch from the payload).
  useEffect(() => {
    const channel = supabase
      .channel(`billing-pricing-${visitId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visit_pricing', filter: `visit_id=eq.${visitId}` },
        () => queryClient.invalidateQueries({ queryKey: pricingKey }),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId])

  const detailKey = ['billing-detail', visitId]
  const detailEnabled = visit?.stage === 'ready_at_reception' || visit?.stage === 'paid'
  const { data: detail } = useQuery({
    queryKey: detailKey,
    enabled: detailEnabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_visit_billing_detail', { p_visit_id: visitId })
      if (error) throw error
      return data as DetailRow[]
    },
  })
  const detailStillLoading = detail === undefined

  const { data: clinic } = useQuery({
    // Its own key, not shared with ClinicSettings.tsx's admin-form query --
    // that one selects the same clinic row but its own overlapping-but-
    // different field set, and two shapes racing under one React Query
    // cache key is exactly the kind of bug that reads fine until the
    // wrong component's fetch happens to win.
    queryKey: ['clinic-print-info', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clinics')
        .select('name, upi_vpa, doctor_name, doctor_registration_number, address, phone')
        .eq('id', clinicId)
        .single()
      if (error) throw error
      return data as {
        name: string
        upi_vpa: string | null
        doctor_name: string | null
        doctor_registration_number: string | null
        address: string | null
        phone: string | null
      }
    },
  })

  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]['value']>('cash')
  const [confirmedBill, setConfirmedBill] = useState<Bill | null>(null)
  const paidBillKey = ['paid-bill', visitId]
  const { data: savedBill } = useQuery({
    queryKey: paidBillKey,
    enabled: visit?.stage === 'paid',
    queryFn: async () => {
      const { data, error } = await supabase.from('bills')
        .select('id, final_amount_paise, payment_method, confirmed_at, bill_line_items(kind, description, quantity, unit_price_paise, line_total_paise)')
        .eq('clinic_id', clinicId).eq('visit_id', visitId).is('corrects_bill_id', null)
        .order('confirmed_at', { ascending: false }).limit(1).single()
      if (error) throw error
      return data as Bill
    },
  })
  const bill = confirmedBill?.pending ? savedBill ?? confirmedBill : confirmedBill ?? savedBill ?? null

  const confirmPayment = useMutation({
    networkMode: 'always',
    mutationFn: async (): Promise<Bill> => {
      // The snapshot is taken right here, at the moment of the click, from
      // whatever this screen currently has cached -- not re-read after the
      // fact. If this ends up queued and the doctor's own device syncs a
      // revision in before this replays, confirm_bill bills exactly this
      // snapshot and the reconciliation trigger flags the mismatch, per
      // docs/architecture-spec.md's offline money-conflict design -- never
      // a silent re-read of whatever is live by then.
      const snapshotAmount = pricing!.final_amount_paise
      const snapshotRevision = pricing!.revision_number

      const { queued } = await attemptOrQueue({
        clinicId,
        attempt: async (accessToken) => {
          const { error } = await supabase.rpc('confirm_bill', {
            p_visit_id: visitId,
            p_payment_method: paymentMethod,
            p_snapshot_final_amount_paise: snapshotAmount,
            p_snapshot_revision_number: snapshotRevision,
          }).setHeader('Authorization', `Bearer ${accessToken}`)
          return { error }
        },
        queueItem: () => ({
          kind: 'rpc',
          rpc: 'confirm_bill',
          payload: {
            p_visit_id: visitId,
            p_payment_method: paymentMethod,
            p_snapshot_final_amount_paise: snapshotAmount,
            p_snapshot_revision_number: snapshotRevision,
          },
          description: `Confirm ${paymentMethod} payment for ${visit?.patients?.name ?? 'a visit'}`,
        }),
        applyOptimistic: () => queryClient.setQueryData<Visit>(visitKey, (old) => (old ? { ...old, stage: 'paid' } : old)),
      })

      if (!queued) {
        // Online path: confirm_bill already ran -- the same visit_id +
        // "latest original bill" lookup confirm_bill's own early-return
        // uses internally, since attemptOrQueue's attempt callback only
        // surfaces { error }, not the RPC's returned id.
        const { data: bill, error: billErr } = await supabase
          .from('bills')
          .select('id, final_amount_paise, payment_method, confirmed_at, bill_line_items(kind, description, quantity, unit_price_paise, line_total_paise)')
          .eq('visit_id', visitId)
          .is('corrects_bill_id', null)
          .order('confirmed_at', { ascending: false })
          .limit(1)
          .single()
        if (billErr) throw billErr
        return bill as Bill
      }

      // Offline: there is no real bill row yet (confirm_bill hasn't run) --
      // the patient is standing here regardless, so print proceeds from
      // exactly what this screen already knows, with no server id to show.
      return { id: 'pending', final_amount_paise: snapshotAmount, payment_method: paymentMethod, confirmed_at: new Date().toISOString(), pending: true, bill_line_items: detail!.map((row) => ({ kind: row.kind, description: row.description, quantity: row.quantity ?? 1, unit_price_paise: row.unit_price_paise, line_total_paise: row.line_total_paise ?? row.unit_price_paise })) }
    },
    onSuccess: (bill) => {
      setConfirmedBill(bill)
      queryClient.setQueryData(paidBillKey, bill)
      queryClient.invalidateQueries({ queryKey: visitKey })
      queryClient.invalidateQueries({ queryKey: ['visits-today', clinicId] })
      // Give the DOM a tick to render the printable slip before invoking
      // the browser's print dialog -- the print path stays DOM-based, no
      // server round trip, works with zero connectivity, queued or not.
      setTimeout(() => window.print(), 100)
    },
  })

  if (!visit || !pricing) return <p className="readout-empty">Loading…</p>

  if (visit.stage === 'paid' && !bill) return <p className="readout-empty">Loading saved receipt…</p>
  const waitingForDoctor = !pricing.final_amount_set
  const amountPaise = bill ? bill.final_amount_paise : pricing.final_amount_paise
  const billable = bill?.bill_line_items ?? detail
  const calculatedTotal = bill?.bill_line_items ? bill.bill_line_items.reduce((sum, row) => sum + row.line_total_paise, 0) : pricing.calculated_total_paise
  const discountPaise = calculatedTotal - amountPaise

  return (
    <div>
      <h2 className="form-heading">
        {visit.patients?.name} <span className="doctor-queue-meta">Token {visit.token_number}</span>
      </h2>
      {openBill.isError && <p className="form-error">Couldn't open the bill — try again.</p>}

      <section className="record-section">
        <h3 className="readout-heading">Itemised breakdown</h3>
        {!billable ? (
          <p className="readout-empty">Loading…</p>
        ) : (
          <ul className="past-visit-list">
            {billable.map((row, i) => (
              <li key={i} className="past-visit-item bill-item-row">
                <span>{row.description}</span>
                <span className="pricing-value">{formatPaise(row.line_total_paise ?? row.unit_price_paise)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="record-section">
        <div className="pricing-block">
          <div className="pricing-row">
            <span>Calculated total</span>
            <span className="pricing-value">{formatPaise(calculatedTotal)}</span>
          </div>
          <div className="pricing-row">
            <span>Discount</span>
            <span className="pricing-value">{formatPaise(discountPaise)}</span>
          </div>
          <div className="pricing-row bill-final-amount">
            <span>Amount to collect</span>
            {waitingForDoctor ? (
              <span className="readout-empty">Waiting for the doctor to confirm the amount</span>
            ) : (
              <span className="bill-final-amount-value">{formatPaise(amountPaise)}</span>
            )}
          </div>
        </div>
      </section>

      {waitingForDoctor && (
        <section className="record-section">
          <div className="action-row">
            <Button type="button" variant="secondary" onClick={onClose}>
              Back to queue
            </Button>
          </div>
        </section>
      )}

      {!bill && !waitingForDoctor && (
        <section className="record-section">
          <h3 className="readout-heading">Payment method</h3>
          <div className="payment-method-row">
            {PAYMENT_METHODS.map((m) => (
              <label key={m.value} className="payment-method-option">
                <input
                  type="radio"
                  name="payment-method"
                  value={m.value}
                  checked={paymentMethod === m.value}
                  onChange={() => setPaymentMethod(m.value)}
                />
                {m.label}
              </label>
            ))}
          </div>
          {paymentMethod === 'upi' &&
            (clinic?.upi_vpa ? (
              <UpiQr vpa={clinic.upi_vpa} amountPaise={pricing.final_amount_paise} payeeName={clinic.name} />
            ) : (
              <p className="readout-empty">UPI ID not configured for this clinic yet.</p>
            ))}
          <div className="action-row">
            <motion.button
              type="button"
              className={buttonVariants({ variant: 'primary' })}
              whileTap={{ scale: 0.96, rotate: -1 }}
              disabled={confirmPayment.isPending || detailStillLoading}
              onClick={() => confirmPayment.mutate()}
            >
              {confirmPayment.isPending ? 'Confirming…' : detailStillLoading ? 'Loading receipt details…' : 'Confirm payment'}
            </motion.button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Back to queue
            </Button>
          </div>
          {detailStillLoading && <p className="readout-empty">Instructions are not saved on this device yet. During an outage, print the prescription from the doctor’s screen.</p>}
          {confirmPayment.isError && <p className="form-error">Couldn't confirm — try again.</p>}
        </section>
      )}

      {bill && (
        <section className="record-section">
          <div className="paid-stamp" aria-hidden="true">
            Paid
          </div>
          <p>
            Paid via {bill.payment_method}. Prescription and receipt sent to print.
            {bill.pending && ' Not saved yet — waiting for a connection to actually confirm with the server.'}
          </p>
          <div className="action-row">
            <Button type="button" variant="secondary" onClick={() => window.print()}>
              Print again
            </Button>
            <Button type="button" onClick={onClose}>
              Back to queue
            </Button>
          </div>
        </section>
      )}

      <PrintableSlip
        clinic={clinic}
        visit={visit}
        detail={detail}
        amountPaise={amountPaise}
        discountPaise={discountPaise}
        bill={bill}
      />
    </div>
  )
}
