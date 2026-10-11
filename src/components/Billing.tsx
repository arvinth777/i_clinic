import { usePrintDocument } from '../lib/usePrintDocument'
import { LoadingRows, QueryError } from './QueryState'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { formatPaise } from '../lib/money'
import { PrintableSlip, PrintableReceipt, type PrintVisit as Visit, type DetailRow, type Bill } from './VisitPrintout'
import { attemptOrQueue } from '../lib/offlineQueue'
import { PricingPanel } from './PricingPanel'
import { Input } from './ui/input'
import { Button, buttonVariants } from './ui/button'
import './Billing.css'

type ApprovedLine = DetailRow & {prescription_item_id?:string;available_quantity:number;approved_quantity?:number;shortfall?:number}
type Approval = {lines:ApprovedLine[];revision_number:number;final_amount_paise:number;discount_paise:number}

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

export function Billing({ clinicId, visitId, onClose, readOnly = false }: { clinicId: string; visitId: string; onClose: () => void; readOnly?: boolean }) {
  const queryClient = useQueryClient()

  const discountRequest = useMutation({networkMode:'always',mutationFn:async()=>{
    const args={p_visit_id:visitId,p_request_id:crypto.randomUUID()}
    await attemptOrQueue({clinicId,attempt:token=>supabase.rpc('request_bill_discount',args).setHeader('Authorization',`Bearer ${token}`),queueItem:()=>({kind:'rpc',rpc:'request_bill_discount',payload:args,description:'Ask doctor to review discount'}),applyOptimistic:()=>queryClient.setQueryData<Visit>(['billing-visit',visitId],old=>old?{...old,discount_requested_at:new Date().toISOString()}:old)})
  },onSuccess:()=>{void queryClient.invalidateQueries({queryKey:['billing-visit',visitId]});void queryClient.invalidateQueries({queryKey:['doctor-queue',clinicId]})}})

  const visitKey = ['billing-visit', visitId]
  const visitQuery = useQuery({
    queryKey: visitKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, token_number, stage, arrived_at, complaint, follow_up_date, discount_requested_at, patients(name, age, gender)')
        .eq('id', visitId)
        .single()
      if (error) throw error
      return data as unknown as Visit
    },
  })
  const { data: visit } = visitQuery

  const pricingKey = ['billing-pricing', visitId]
  const pricingQuery = useQuery({
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
  const { data: pricing } = pricingQuery

  // The doctor can still be editing pricing on his own screen while this
  // panel is open -- Realtime is how this screen finds out (non-negotiable
  // #6: invalidate and refetch, never patch from the payload).
  useEffect(() => {
    const channel = supabase
      .channel(`billing-pricing-${visitId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'visit_pricing', filter: `visit_id=eq.${visitId}` },
        () => {void queryClient.invalidateQueries({queryKey:pricingKey});void queryClient.invalidateQueries({queryKey:['approved-bill',visitId]});void queryClient.invalidateQueries({queryKey:visitKey})},
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId])

  const detailKey = ['billing-detail', visitId]
  const detailEnabled = visit?.stage === 'ready_to_bill' || visit?.stage === 'paid'
  const detailQuery = useQuery({
    queryKey: detailKey,
    enabled: detailEnabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_visit_billing_detail', { p_visit_id: visitId })
      if (error) throw error
      return data as DetailRow[]
    },
  })
  const approvalQuery = useQuery({queryKey:['approved-bill',visitId],enabled:detailEnabled,queryFn:async()=>{const {data,error}=await supabase.rpc('get_approved_bill',{p_visit_id:visitId});if(error)throw error;return data as Approval | null}})
  const approval = approvalQuery.data
  const detail = approval?.lines ?? detailQuery.data
  const [supplied, setSupplied] = useState<Record<string,string>>({})
  const detailStillLoading = !detail?.length || detail.some(row => !('diagnosis' in row) || !('advice' in row))
  const clinicalNotes = detailStillLoading ? undefined : { diagnosis: [...new Set(detail.map(row => row.diagnosis).filter(Boolean))].join('\n'), advice: [...new Set(detail.map(row => row.advice).filter(Boolean))].join('\n') }

  const clinicQuery = useQuery({
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
  const { data: clinic } = clinicQuery

  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]['value']>('cash')
  const print = usePrintDocument(`${clinicId}:${visitId}`)
  const [confirmedBill, setConfirmedBill] = useState<Bill | null>(null)
  const paidBillKey = ['paid-bill', visitId]
  const savedBillQuery = useQuery({
    queryKey: paidBillKey,
    enabled: visit?.stage === 'paid',
    queryFn: async () => {
      const { data, error } = await supabase.from('bills')
        .select('id, final_amount_paise, payment_method, confirmed_at, bill_line_items(kind, description, quantity, unit_price_paise, line_total_paise, stock_unit, approved_quantity, shortfall)')
        .eq('clinic_id', clinicId).eq('visit_id', visitId).is('corrects_bill_id', null)
        .order('confirmed_at', { ascending: false }).limit(1).single()
      if (error) throw error
      return data as Bill
    },
  })
  const { data: savedBill } = savedBillQuery
  const bill = confirmedBill?.pending ? savedBill ?? confirmedBill : confirmedBill ?? savedBill ?? null

  const supplyLines = approval?.lines.map(row => {
    const quantity = row.prescription_item_id && supplied[row.prescription_item_id] !== undefined ? Number(supplied[row.prescription_item_id]) : row.quantity ?? 1
    return {...row,quantity,approved_quantity:row.kind==='medicine'?row.quantity:undefined,shortfall:row.kind==='medicine'?(row.quantity??0)-quantity:0,line_total_paise:quantity*row.unit_price_paise}
  })
  const subtotal = supplyLines?.reduce((sum,row)=>sum+row.line_total_paise,0) ?? pricing?.calculated_total_paise ?? 0
  const supplyInvalid = !Number.isSafeInteger(subtotal) || supplyLines?.some(row=>!Number.isInteger(row.quantity)||row.quantity<0||(row.kind==='medicine'&&(row.quantity>(row.approved_quantity??0)||row.quantity>Math.max(0,row.available_quantity))))
  const approvalOutdated=!!approval && !!pricing && approval.revision_number!==pricing.revision_number
  const payable = Math.max(0,subtotal-(approval?.discount_paise??pricing?.discount_paise??0))

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
      if(!approval || !supplyLines || supplyInvalid || approvalOutdated) throw new Error('Review supplied quantities and current stock before payment.')
      const snapshotAmount = approval.final_amount_paise
      const snapshotRevision = approval.revision_number
      const suppliedItems=supplyLines.filter(row=>row.kind==='medicine').map(row=>({prescription_item_id:row.prescription_item_id,quantity:row.quantity}))

      const { queued } = await attemptOrQueue({
        clinicId,
        attempt: async (accessToken) => {
          const { error } = await supabase.rpc('confirm_bill', {
            p_visit_id: visitId,
            p_payment_method: paymentMethod,
            p_snapshot_final_amount_paise: snapshotAmount,
            p_snapshot_revision_number: snapshotRevision,
            p_supplied_items: suppliedItems,
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
            p_supplied_items: suppliedItems,
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
          .select('id, final_amount_paise, payment_method, confirmed_at, bill_line_items(kind, description, quantity, unit_price_paise, line_total_paise, stock_unit, approved_quantity, shortfall)')
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
      return { id: 'pending', final_amount_paise: payable, approved_discount_paise:approval.discount_paise, payment_method: paymentMethod, confirmed_at: new Date().toISOString(), pending: true, bill_line_items: supplyLines }
    },
    onSuccess: (bill) => {
      setConfirmedBill(bill)
      queryClient.setQueryData(paidBillKey, bill)
      queryClient.invalidateQueries({ queryKey: visitKey })
      queryClient.invalidateQueries({ queryKey: ['visits-today', clinicId] })
      // Give the DOM a tick to render the printable slip before invoking
      // the browser's print dialog -- the print path stays DOM-based, no
      // server round trip, works with zero connectivity, queued or not.
      setTimeout(() => print.mutate(), 100)
    },
  })

  const failedReads = [visitQuery, pricingQuery, detailQuery, approvalQuery, clinicQuery, savedBillQuery].filter(query => query.isError)
  const queryError = failedReads.length > 0 ? <QueryError retry={() => { failedReads.forEach(query => void query.refetch()) }} savedAt={Math.min(...failedReads.map(query => query.dataUpdatedAt)) || undefined} /> : null
  if (!visit || !pricing || (visit.stage === 'paid' && !bill)) return <div className="bill-editor"><Button variant="ghost" onClick={onClose}>← Back</Button>{queryError ?? <LoadingRows label="Loading bill…" />}</div>
  const waitingForDoctor = !bill && (!pricing.final_amount_set || !approval)
  const amountPaise = bill ? bill.final_amount_paise : payable
  const billable = bill?.bill_line_items ?? supplyLines ?? detail
  const calculatedTotal = bill?.bill_line_items ? bill.bill_line_items.reduce((sum, row) => sum + row.line_total_paise, 0) : subtotal
  const discountPaise = calculatedTotal - amountPaise

  return (
    <div className="billing-workspace"><div className="bill-editor">
      <Button className="mobile-list-back" variant="ghost" onClick={onClose}>← Back</Button>
      {queryError}{print.isError && <p className="form-error" role="alert">{print.error.message}</p>}
      <div className={failedReads.length ? "stale-copy" : undefined}>
      <p className="field-hint">{bill ? 'Saved receipt' : 'Consultation bill'} · #{visit.token_number}</p>
      <h2 className="form-heading">
        {visit.patients?.name} <span className="doctor-queue-meta">Token {visit.token_number}</span>
      </h2>
      {detail?.some((row) => row.kind === 'medicine' && !row.stock_unit) && visit.stage !== 'paid' && <p className="form-error">Confirm medicine units under Stock and ask the doctor to review supplied quantities before payment.</p>}

      <section className="record-section">
        <h3 className="readout-heading">Itemised breakdown</h3>
        {!billable ? (
          <LoadingRows label="Loading…" />
        ) : (
          <div className="bill-table-wrap"><table className="bill-lines"><thead><tr><th>Item</th><th>Supplied</th><th>Price</th><th>Amount</th></tr></thead><tbody>
            {billable.map((row, i) => <tr key={i}><td><strong>{row.description}</strong><small>{row.kind === 'consultation' ? 'Consultation fee' : row.kind === 'procedure' ? 'Procedure' : row.stock_unit}</small></td><td>{!bill && !readOnly && row.kind==='medicine' && row.prescription_item_id ? <Input type="number" inputMode="numeric" min={0} max={Math.min(row.approved_quantity??0,row.available_quantity??0)} step={1} aria-label={`Supplied quantity for ${row.description}`} value={supplied[row.prescription_item_id]??String(row.quantity??0)} onChange={e=>setSupplied(old=>({...old,[row.prescription_item_id!]:e.target.value}))}/> : row.quantity ?? 1}{row.kind==='medicine' && 'approved_quantity' in row && row.approved_quantity!=null && <small>{row.approved_quantity} approved{'shortfall' in row && !!row.shortfall && ` · ${row.shortfall} not supplied`}</small>}</td><td>{formatPaise(row.unit_price_paise)}</td><td><strong>{formatPaise(row.line_total_paise ?? row.unit_price_paise)}</strong></td></tr>)}
          </tbody></table></div>
        )}
      </section>

      {approvalOutdated && !bill && <p className="status-amber">The doctor updated this bill. Refreshing the approved amount…</p>}
      {supplyInvalid && !bill && <p className="form-error">Use whole supplied units within the approved quantity and available Counter stock.</p>}
      <section className="record-section">
        <div className="pricing-block">
          <div className="pricing-row">
            <span>Calculated total</span>
            <span className="pricing-value">{formatPaise(calculatedTotal)}</span>
          </div>
          <div className="pricing-row">
            <span>Discount set by the doctor{approval && discountPaise<approval.discount_paise ? ` (capped from ${formatPaise(approval.discount_paise)})` : ''}</span>
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

      {!bill && !readOnly && <><Button variant="secondary" disabled={discountRequest.isPending || !!visit.discount_requested_at} onClick={()=>discountRequest.mutate()}>{visit.discount_requested_at ? 'Discount review requested' : 'Ask doctor to change discount'}</Button>{discountRequest.isError && <p className="form-error">{discountRequest.error.message}</p>}</>}
      {!bill && readOnly && <details className="rx-support" open={!!visit.discount_requested_at}><summary>{visit.discount_requested_at ? 'Reception requests a discount review' : 'Review discount'}</summary><PricingPanel clinicId={clinicId} visitId={visitId} reviewRequested={!!visit.discount_requested_at} /></details>}
      {waitingForDoctor && (
        <section className="record-section">
          <div className="action-row">
            <Button type="button" variant="secondary" onClick={onClose}>
              Back to queue
            </Button>
          </div>
        </section>
      )}

      {!bill && !waitingForDoctor && !readOnly && (
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
              <UpiQr vpa={clinic.upi_vpa} amountPaise={amountPaise} payeeName={clinic.name} />
            ) : (
              <p className="readout-empty">UPI ID not configured for this clinic yet.</p>
            ))}
          <div className="action-row">
            <button
              type="button"
              className={buttonVariants({ variant: 'primary' })}
              data-press="stamp"
              disabled={confirmPayment.isPending || detailStillLoading || supplyInvalid || approvalOutdated}
              onClick={() => confirmPayment.mutate()}
            >
              {confirmPayment.isPending ? 'Confirming…' : detailStillLoading ? 'Loading receipt details…' : `Mark paid · ${formatPaise(amountPaise)}`}
            </button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Back to queue
            </Button>
          </div>
          {detailStillLoading && <p className="readout-empty">Instructions are not saved on this device yet. During an outage, print the prescription from the doctor’s screen.</p>}
          {confirmPayment.isError && <p className="form-error">{confirmPayment.error.message}</p>}
        </section>
      )}

      {bill && (
        <section className="record-section">
          <div className="paid-stamp" aria-hidden="true">
            Paid
          </div>
          <p>
            Paid via {bill.payment_method}. Print the prescription and receipt below.
            {bill.pending && ' Not saved yet — waiting for a connection to actually confirm with the server.'}
          </p>
          <div className="action-row">
            <Button type="button" variant="dark" disabled={detailStillLoading || print.isPending} onClick={() => print.mutate()}>
              Print again
            </Button>
            <Button type="button" onClick={onClose}>
              Back to queue
            </Button>
          </div>
        </section>
      )}

      </div></div>
      <aside className="receipt-preview" aria-label="Receipt preview"><div className="sticky-panel"><p className="field-hint">Receipt preview</p><PrintableReceipt clinic={clinic} visit={visit} billable={billable ?? []} amountPaise={amountPaise} discountPaise={discountPaise} bill={bill} /></div></aside>
      <PrintableSlip
        clinic={clinic}
        visit={{ ...visit, ...clinicalNotes }}
        detail={detailStillLoading ? undefined : detail}
        amountPaise={amountPaise}
        discountPaise={discountPaise}
        bill={bill}
      />
    </div>
  )
}
