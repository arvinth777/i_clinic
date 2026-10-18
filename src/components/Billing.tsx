import { DocumentArchives } from './DocumentArchives'
import { usePrintDocument } from '../lib/usePrintDocument'
import { LoadingRows, QueryError } from './QueryState'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import { formatPaise } from '../lib/money'
import { hasPrintableLines } from '../lib/receiptLines'
import { PrintableReceipt, type PrintVisit as Visit, type DetailRow, type BillLine, type Bill } from './VisitPrintout'
import { attemptOrQueue } from '../lib/offlineQueue'
import { Input } from './ui/input'
import { Button, buttonVariants } from './ui/button'
import './Billing.css'

type PrescribedItem = {prescription_item_id:string;medicine_id:string;molecule_name:string;strength:string|null;quantity:number;stock_unit:string|null}
type ReceptionPlan = {consultation_charge_paise:number;medicines:PrescribedItem[]}
type CatalogMedicine = {id:string;name:string;molecule_name:string|null;strength_options:string[]|null;stock_unit:string|null;unit_confirmed_at:string|null;price_paise:number}
type SupplyLine = BillLine & {prescription_item_id?:string;medicine_id?:string;available_quantity?:number;shortfall?:number}

const normal = (text: string | null | undefined) => text?.trim().toLocaleLowerCase('en-IN') ?? ''

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
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

  const visitKey = ['billing-visit', visitId]
  const visitQuery = useQuery({
    queryKey: visitKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('visits')
        .select('id, token_number, stage, arrived_at, complaint, follow_up_date, discount_requested_at, patients(name, age, gender, height_cm, weight_kg)')
        .eq('id', visitId)
        .single()
      if (error) throw error
      return data as unknown as Visit
    },
  })
  const { data: visit } = visitQuery

  // Realtime invalidates the server plan; it never patches money from an event.
  useEffect(() => {
    const channel = supabase
      .channel(`billing-plan-${visitId}`)
      .on('postgres_changes', {event:'*',schema:'public',table:'visits',filter:`id=eq.${visitId}`}, () => {void queryClient.invalidateQueries({queryKey:visitKey});void queryClient.invalidateQueries({queryKey:['reception-bill-plan',visitId]})})
      .on('postgres_changes', {event:'*',schema:'public',table:'medicines',filter:`clinic_id=eq.${clinicId}`}, () => {void queryClient.invalidateQueries({queryKey:['billing-catalog',clinicId]})})
      .on('postgres_changes', {event:'*',schema:'public',table:'medicine_stock',filter:`clinic_id=eq.${clinicId}`}, () => {void queryClient.invalidateQueries({queryKey:['billing-counter-stock',clinicId]})})
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId, clinicId])

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
  const planQuery = useQuery({queryKey:['reception-bill-plan',visitId],enabled:visit?.stage === 'ready_to_bill',queryFn:async()=>{const {data,error}=await supabase.rpc('get_reception_bill',{p_visit_id:visitId});if(error)throw error;return data as ReceptionPlan}})
  const catalogQuery = useQuery({queryKey:['billing-catalog',clinicId],enabled:visit?.stage === 'ready_to_bill',queryFn:async()=>{const {data,error}=await supabase.from('medicines').select('id,name,molecule_name,strength_options,stock_unit,unit_confirmed_at,price_paise').eq('clinic_id',clinicId).eq('is_active',true).order('name');if(error)throw error;return data as CatalogMedicine[]}})
  const stockQuery = useQuery({queryKey:['billing-counter-stock',clinicId],enabled:visit?.stage === 'ready_to_bill',queryFn:async()=>{const {data,error}=await supabase.from('medicine_stock').select('medicine_id,quantity,stock_points!inner(name)').eq('clinic_id',clinicId).eq('stock_points.name','Counter');if(error)throw error;return data as {medicine_id:string;quantity:number}[]}})
  const detail = detailQuery.data
  const [selectedBrands, setSelectedBrands] = useState<Record<string,string>>({})
  const [supplied, setSupplied] = useState<Record<string,string>>({})
  const detailStillLoading = visit?.stage === 'ready_to_bill' && (!detail || !planQuery.data || !catalogQuery.data || !stockQuery.data)

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

  const plan = planQuery.data
  const choicesFor = (item: PrescribedItem) => (catalogQuery.data ?? []).filter(m => m.unit_confirmed_at && normal(m.stock_unit) === normal(item.stock_unit) && normal(m.molecule_name || m.name) === normal(item.molecule_name) && (m.id === item.medicine_id && !m.strength_options?.length || !!item.strength && m.strength_options?.some(s => normal(s) === normal(item.strength))))
  const stockByMedicine = new Map((stockQuery.data ?? []).map(row => [row.medicine_id, row.quantity]))
  // Pre-pick the product when there is no real choice: the only match, or the only one with Counter stock. Reception can still change it.
  const autoChoice = (item: PrescribedItem) => {
    const choices = choicesFor(item)
    if (choices.length === 1) return choices[0].id
    const stocked = choices.filter(choice => (stockByMedicine.get(choice.id) ?? 0) > 0)
    return stocked.length === 1 ? stocked[0].id : undefined
  }
  const pickedBrand = (item: PrescribedItem) => selectedBrands[item.prescription_item_id] ?? autoChoice(item)
  const chosenFor = (item: PrescribedItem) => choicesFor(item).find(m => m.id === pickedBrand(item))
  const supplyLines: SupplyLine[] | undefined = plan && detail ? [
    {kind:'consultation',description:'Consultation',quantity:1,unit_price_paise:plan.consultation_charge_paise,line_total_paise:plan.consultation_charge_paise},
    ...detail.filter(row => row.kind === 'procedure').map(row => ({kind:'procedure' as const,description:row.description,quantity:1,unit_price_paise:row.unit_price_paise,line_total_paise:row.unit_price_paise})),
    ...plan.medicines.map(item => {
      const chosen = chosenFor(item)
      const quantity = supplied[item.prescription_item_id] === undefined ? item.quantity : supplied[item.prescription_item_id].trim() === '' ? NaN : Number(supplied[item.prescription_item_id])
      return {kind:'medicine' as const,description:chosen?.name ?? `${item.molecule_name} ${item.strength ?? ''}`.trim(),medicine_id:chosen?.id,prescription_item_id:item.prescription_item_id,stock_unit:chosen?.stock_unit,quantity,approved_quantity:item.quantity,available_quantity:chosen ? stockByMedicine.get(chosen.id) ?? 0 : 0,unit_price_paise:chosen?.price_paise ?? 0,line_total_paise:quantity*(chosen?.price_paise ?? 0),shortfall:item.quantity-quantity}
    }),
  ] : undefined
  const subtotal = supplyLines?.reduce((sum,row)=>sum+row.line_total_paise,0) ?? 0
  const supplyInvalid = !Number.isSafeInteger(subtotal) || supplyLines?.some(row=>!Number.isInteger(row.quantity)||row.quantity<0||(row.kind==='medicine'&&(row.quantity>(row.approved_quantity??0)||(row.quantity>0&&(!row.medicine_id||row.quantity>Math.max(0,row.available_quantity??0))))))
  // Say WHICH line and WHICH rule failed -- the old single sentence hid that the drug simply had no stock.
  const supplyProblem = supplyLines?.map(row => {
    if (row.kind !== 'medicine') return null
    if (!Number.isInteger(row.quantity) || row.quantity < 0) return `${row.description}: enter a whole number of units.`
    if (row.quantity > (row.approved_quantity ?? 0)) return `${row.description}: more than the ${row.approved_quantity ?? 0} the doctor approved.`
    if (row.quantity === 0) return null
    if (!row.medicine_id) {
      const item = plan?.medicines.find(m => m.prescription_item_id === row.prescription_item_id)
      return item && choicesFor(item).length === 0
        ? `${row.description}: no stocked product matches this molecule, strength and unit. Add that product (with its unit and price confirmed) under Stock and refresh this bill, or enter 0 to leave it out.`
        : `${row.description}: choose the stocked product that matches the doctor's molecule and strength, or enter 0 to leave it out.`
    }
    if (row.quantity > Math.max(0, row.available_quantity??0)) return `${row.description}: only ${Math.max(0, row.available_quantity??0)} in Counter stock. Reduce the supplied units (0 if none can be supplied) or receive stock under Stock.`
    return null
  }).find(Boolean)
  const payable = subtotal

  const confirmPayment = useMutation({
    networkMode: 'always',
    mutationFn: async (): Promise<Bill> => {
      // A queued retry carries these reviewed choices and prices; the server
      // rejects stale catalog totals rather than silently charging new ones.
      if(!plan || !supplyLines || supplyInvalid) throw new Error('Choose matching medicines and review supplied quantities before payment.')
      const suppliedItems=supplyLines.filter(row=>row.kind==='medicine').map(row=>({prescription_item_id:row.prescription_item_id,medicine_id:row.medicine_id,quantity:row.quantity,unit_price_paise:row.unit_price_paise,stock_unit:row.stock_unit}))
      const args = {p_visit_id:visitId,p_payment_method:paymentMethod,p_expected_total_paise:subtotal,p_items:suppliedItems}

      const { queued } = await attemptOrQueue({
        clinicId,
        attempt: async (accessToken) => {
          const { error } = await supabase.rpc('confirm_reception_bill', args).setHeader('Authorization', `Bearer ${accessToken}`)
          return { error }
        },
        queueItem: () => ({
          kind: 'rpc',
          rpc: 'confirm_reception_bill',
          payload: args,
          description: `Confirm ${paymentMethod} payment for ${visit?.patients?.name ?? 'a visit'}`,
        }),
        applyOptimistic: () => queryClient.setQueryData<Visit>(visitKey, (old) => (old ? { ...old, stage: 'paid' } : old)),
      })

      if (!queued) {
        // Online path: confirmation already ran -- the same visit_id +
        // "latest original bill" lookup the RPC's early-return
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

      // Offline: there is no real bill row yet (confirmation hasn't run) --
      // the patient is standing here regardless, so print proceeds from
      // exactly what this screen already knows, with no server id to show.
      return { id: 'pending', final_amount_paise: payable, approved_discount_paise:0, payment_method: paymentMethod, confirmed_at: new Date().toISOString(), pending: true, bill_line_items: supplyLines }
    },
    onSuccess: (bill) => {
      setConfirmedBill(bill)
      queryClient.setQueryData(paidBillKey, bill)
      queryClient.invalidateQueries({ queryKey: visitKey })
      queryClient.invalidateQueries({ queryKey: ['visits-today', clinicId] })
      // Give the DOM a tick to render the printable slip before invoking
      // the browser's print dialog -- the print path stays DOM-based, no
      // server round trip, works with zero connectivity, queued or not.
      if (hasPrintableLines(bill.bill_line_items ?? [])) setTimeout(() => print.mutate(), 100)
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ['reception-bill-plan', visitId] })
      void queryClient.invalidateQueries({ queryKey: ['billing-catalog', clinicId] })
      void queryClient.invalidateQueries({ queryKey: ['billing-counter-stock', clinicId] })
    },
  })

  const failedReads = [visitQuery, detailQuery, planQuery, catalogQuery, stockQuery, clinicQuery, savedBillQuery].filter(query => query.isError)
  const queryError = failedReads.length > 0 ? <QueryError retry={() => { failedReads.forEach(query => void query.refetch()) }} savedAt={Math.min(...failedReads.map(query => query.dataUpdatedAt)) || undefined} /> : null
  if (!visit || (visit.stage === 'paid' && !bill)) return <div className="bill-editor"><Button variant="ghost" onClick={onClose}>← Back</Button>{queryError ?? <LoadingRows label="Loading bill…" />}</div>
  const waitingForPlan = !bill && !plan
  const amountPaise = bill ? bill.final_amount_paise : payable
  const billable = bill?.bill_line_items ?? supplyLines ?? detail
  const calculatedTotal = bill?.bill_line_items ? bill.bill_line_items.reduce((sum, row) => sum + row.line_total_paise, 0) : subtotal
  const discountPaise = Math.max(0,calculatedTotal - amountPaise)
  const canPrint = hasPrintableLines(billable ?? [])

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
            {billable.map((row, i) => {
              const prescribed = plan?.medicines.find(item => item.prescription_item_id === row.prescription_item_id)
              return <tr key={i}><td><strong>{row.description}</strong><small>{row.kind === 'consultation' ? 'Consultation charge set by doctor' : row.kind === 'procedure' ? 'Procedure' : row.stock_unit}</small>{!bill && prescribed && !readOnly && <label className="field bill-brand-field"><span className="field-label">Stocked product · {prescribed.molecule_name} {prescribed.strength}</span><select value={pickedBrand(prescribed) ?? ''} onChange={e => setSelectedBrands(old => ({...old,[prescribed.prescription_item_id]:e.target.value}))}><option value="">Choose matching product</option>{choicesFor(prescribed).map(choice => <option key={choice.id} value={choice.id}>{choice.name} · {formatPaise(choice.price_paise)} / {choice.stock_unit} · {stockByMedicine.get(choice.id) ?? 0} available</option>)}</select></label>}</td><td>{!bill && !readOnly && row.kind==='medicine' && row.prescription_item_id ? <Input type="number" inputMode="numeric" min={0} max={Math.min(row.approved_quantity??0,row.available_quantity??0)} step={1} aria-label={`Supplied quantity for ${row.description}`} value={supplied[row.prescription_item_id]??String(row.quantity??0)} onChange={e=>setSupplied(old=>({...old,[row.prescription_item_id!]:e.target.value}))}/> : row.quantity ?? 1}{row.kind==='medicine' && 'approved_quantity' in row && row.approved_quantity!=null && <small>{row.approved_quantity} prescribed{'shortfall' in row && !!row.shortfall && ` · ${row.shortfall} not supplied`}</small>}</td><td>{formatPaise(row.unit_price_paise)}</td><td><strong>{formatPaise(row.line_total_paise ?? row.unit_price_paise)}</strong></td></tr>
            })}
          </tbody></table></div>
        )}
      </section>

      {supplyInvalid && !bill && !readOnly && <p className="form-error" role="alert">{supplyProblem ?? 'Use whole supplied units within the approved quantity and available Counter stock.'}</p>}
      <section className="record-section">
        <div className="pricing-block">
          <div className="pricing-row">
            <span>Calculated total</span>
            <span className="pricing-value">{formatPaise(calculatedTotal)}</span>
          </div>
          {discountPaise > 0 && <div className="pricing-row"><span>Discount on saved bill</span><span className="pricing-value">{formatPaise(discountPaise)}</span></div>}
          <div className="pricing-row bill-final-amount">
            <span>Amount to collect</span>
            {waitingForPlan ? (
              <span className="readout-empty">Loading prescription and catalog…</span>
            ) : (
              <span className="bill-final-amount-value">{formatPaise(amountPaise)}</span>
            )}
          </div>
        </div>
      </section>

      {waitingForPlan && (
        <section className="record-section">
          <div className="action-row">
            <Button type="button" variant="secondary" onClick={onClose}>
              Back to queue
            </Button>
          </div>
        </section>
      )}

      {!bill && !waitingForPlan && !readOnly && (
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
              disabled={confirmPayment.isPending || detailStillLoading || supplyInvalid}
              onClick={() => confirmPayment.mutate()}
            >
              {confirmPayment.isPending ? 'Confirming…' : detailStillLoading ? 'Loading receipt details…' : `Mark paid · ${formatPaise(amountPaise)}`}
            </button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Back to queue
            </Button>
          </div>
          {detailStillLoading && <p className="readout-empty">Billing details are loading from the clinic record.</p>}
          {confirmPayment.isError && <p className="form-error">{confirmPayment.error.message}</p>}
        </section>
      )}

      {bill && (
        <section className="record-section">
          <DocumentArchives clinicId={clinicId} billId={bill.id} />
          <div className="paid-stamp" aria-hidden="true">
            Paid
          </div>
          <p>
            Paid via {bill.payment_method}. {canPrint ? 'Print the receipt below; the doctor prints the prescription separately.' : 'No medicines were supplied, so there is no bill to print.'}
            {bill.pending && ' Not saved yet — waiting for a connection to actually confirm with the server.'}
          </p>
          <div className="action-row">
            {canPrint && <Button type="button" variant="dark" disabled={print.isPending} onClick={() => print.mutate()}>
              Print again
            </Button>}
            <Button type="button" onClick={onClose}>
              Back to queue
            </Button>
          </div>
        </section>
      )}

      </div></div>
      <aside className="receipt-preview" aria-label="Receipt preview"><div className="sticky-panel"><p className="field-hint">Receipt preview</p><PrintableReceipt clinic={clinic} visit={visit} billable={billable ?? []} amountPaise={amountPaise} discountPaise={discountPaise} bill={bill} /></div></aside>
      <div className="print-area"><PrintableReceipt clinic={clinic} visit={visit} billable={billable ?? []} amountPaise={amountPaise} discountPaise={discountPaise} bill={bill} /></div>
    </div>
  )
}
