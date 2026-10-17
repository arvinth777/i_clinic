import { DocumentArchives } from '../components/DocumentArchives'
import { usePrintDocument } from '../lib/usePrintDocument'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { attemptOrQueue } from '../lib/offlineQueue'
import { formatPaise, parseRupeesToPaise } from '../lib/money'
import { formatDate } from '../lib/date'
import { PrintableReceipt, type Bill, type BillLine, type ClinicPrintInfo } from '../components/VisitPrintout'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'

type Medicine = { id: string; name: string; stock_unit: string; price_paise: number }
type Sale = { id: string; customer_name: string; created_at: string; final_amount_paise: number; bill_id: string | null; bills: Bill | null; pharmacy_sale_items: (BillLine & { medicine_id: string })[]; pending?: boolean }
type Item = { medicineId: string; quantity: string }

export function PharmacyBills({ clinicId, isDoctor }: { clinicId: string; isDoctor: boolean }) {
  const client = useQueryClient()
  const [limit, setLimit] = useState(50)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(true)
  const print = usePrintDocument(`${clinicId}:${creating ? 'new' : selectedId}`)
  const [saleId, setSaleId] = useState(() => crypto.randomUUID())
  const [name, setName] = useState('')
  const [items, setItems] = useState<Item[]>([{ medicineId: '', quantity: '' }])
  const [verified, setVerified] = useState(false)
  const [method, setMethod] = useState('cash')
  const [finalInput, setFinalInput] = useState('')
  useEffect(() => { void client.invalidateQueries({ queryKey: ['pharmacy-sales', clinicId] }) }, [limit, clinicId, client])
  const salesKey = ['pharmacy-sales', clinicId, search]
  const { data: medicines, error: medicineError } = useQuery({
    queryKey: ['pharmacy-medicines', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from('medicines').select('id, name, stock_unit, price_paise').eq('clinic_id', clinicId).eq('is_active', true).not('unit_confirmed_at', 'is', null).order('name')
      if (error) throw error
      return data as Medicine[]
    },
  })
  const { data: sales, error: salesError } = useQuery({
    queryKey: salesKey,
    refetchInterval: 15000,
    queryFn: async () => {
      let query = supabase.from('pharmacy_sales').select('id, customer_name, created_at, final_amount_paise, bill_id, pharmacy_sale_items(medicine_id, description, quantity, stock_unit, unit_price_paise, line_total_paise), bills!pharmacy_sales_bill_id_fkey(id, final_amount_paise, payment_method, confirmed_at, bill_line_items(kind, description, quantity, stock_unit, unit_price_paise, line_total_paise))').eq('clinic_id', clinicId)
      if (search.trim()) query = query.ilike('customer_name', `%${search.trim()}%`)
      const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)
      if (error) throw error
      const rows = data as unknown as Sale[]
      const waiting = (client.getQueryData<Sale[]>(salesKey) ?? []).filter((local) => local.pending && (!rows.some((row) => row.id === local.id) || local.final_amount_paise !== rows.find((row) => row.id === local.id)?.final_amount_paise || (local.bill_id === 'pending' && !rows.find((row) => row.id === local.id)?.bill_id)))
      return [...waiting, ...rows.filter((row) => !waiting.some((local) => local.id === row.id))]
    },
  })
  useEffect(() => {
    const channel = supabase.channel(`pharmacy-${clinicId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'pharmacy_sales', filter: `clinic_id=eq.${clinicId}` }, () => client.invalidateQueries({ queryKey: ['pharmacy-sales', clinicId] })).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [clinicId, client])
  const { data: clinic } = useQuery({
    queryKey: ['clinic-print-info', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clinics').select('name, upi_vpa, doctor_name, doctor_registration_number, address, phone').eq('id', clinicId).single()
      if (error) throw error
      return data as ClinicPrintInfo
    },
  })
  const selected = sales?.find((s) => s.id === selectedId)
  const draftLines = items.flatMap((i) => {
    const m = medicines?.find((m) => m.id === i.medicineId)
    const quantity = Number(i.quantity)
    return m && Number.isInteger(quantity) && quantity > 0 ? [{ medicine_id: m.id, kind: 'medicine' as const, description: m.name, quantity, stock_unit: m.stock_unit, unit_price_paise: m.price_paise, line_total_paise: quantity * m.price_paise }] : []
  })
  const draftTotal = draftLines.reduce((sum, line) => sum + line.line_total_paise, 0)
  function refresh() {
    client.invalidateQueries({ queryKey: ['pharmacy-sales', clinicId] })
    client.invalidateQueries({ queryKey: ['stock', clinicId] })
    client.invalidateQueries({ queryKey: ['report-daily'] })
    client.invalidateQueries({ queryKey: ['report-monthly'] })
    client.invalidateQueries({ queryKey: ['report-gst'] })
  }
  const save = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      if (!name.trim() || !verified) throw new Error('Enter the name and confirm visual verification')
      if (draftLines.length !== items.length || !draftLines.length || !Number.isSafeInteger(draftTotal)) throw new Error('Choose a medicine and positive whole-number quantity for every line')
      const payload = { p_sale_id: saleId, p_clinic_id: clinicId, p_customer_name: name.trim(), p_items: draftLines.map(({ medicine_id, quantity, stock_unit, unit_price_paise }) => ({ medicine_id, quantity, stock_unit, unit_price_paise })) }
      const result = await attemptOrQueue({ clinicId,
        attempt: (token) => supabase.rpc('save_pharmacy_sale', payload).setHeader('Authorization', `Bearer ${token}`),
        queueItem: () => ({ kind: 'rpc', rpc: 'save_pharmacy_sale', payload, description: 'Prepare pharmacy bill' }),
      })
      client.setQueryData<Sale[]>(salesKey, (old) => [{ id: saleId, customer_name: name.trim(), created_at: new Date().toISOString(), final_amount_paise: draftTotal, bill_id: null, bills: null, pharmacy_sale_items: draftLines, pending: result.queued }, ...(old ?? []).filter((s) => s.id !== saleId)])
    },
    onSuccess: () => { setSelectedId(saleId); setCreating(false); refresh() },
  })
  const confirm = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      if (!selected) throw new Error('Select a saved pharmacy bill')
      const payload = { p_sale_id: selected.id, p_payment_method: method, p_expected_amount_paise: selected.final_amount_paise }
      const result = await attemptOrQueue({ clinicId,
        attempt: (token) => supabase.rpc('confirm_pharmacy_sale', payload).setHeader('Authorization', `Bearer ${token}`),
        queueItem: () => ({ kind: 'rpc', rpc: 'confirm_pharmacy_sale', payload, description: 'Confirm pharmacy payment' }),
      })
      if (result.queued) client.setQueryData<Sale[]>(salesKey, (old) => old?.map((s) => s.id === selected.id ? { ...s, bill_id: 'pending', bills: { id: 'pending', final_amount_paise: s.final_amount_paise, payment_method: method, confirmed_at: new Date().toISOString(), pending: true, bill_line_items: s.pharmacy_sale_items }, pending: true } : s))
    },
    onSuccess: refresh,
  })
  const discount = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      const amount = parseRupeesToPaise(finalInput)
      if (!selected || amount === null) throw new Error('Enter a valid payable amount')
      const payload = { p_sale_id: selected.id, p_final_amount_paise: amount }
      const result = await attemptOrQueue({ clinicId,
        attempt: (token) => supabase.rpc('set_pharmacy_sale_amount', payload).setHeader('Authorization', `Bearer ${token}`),
        queueItem: () => ({ kind: 'rpc', rpc: 'set_pharmacy_sale_amount', payload, description: 'Doctor pharmacy discount or correction' }),
      })
      if (result.queued) client.setQueryData<Sale[]>(salesKey, (old) => old?.map((s) => s.id === selected.id ? { ...s, pending: true, final_amount_paise: amount, bill_id: s.bill_id ? 'pending' : null, bills: s.bills ? { ...s.bills, pending: true, final_amount_paise: amount } : null } : s))
    },
    onSuccess: () => { setFinalInput(''); refresh() },
  })
  function openNew() {
    setSearch(''); setSaleId(crypto.randomUUID()); setName(''); setItems([{ medicineId: '', quantity: '' }]); setVerified(false); setCreating(true); setSelectedId(null); save.reset(); confirm.reset(); discount.reset()
  }
  const createPanel = <div className="admin-page">
    <h2 className="readout-heading">Refill-only sale</h2>
    <p className="field-hint">Medicine-only sale. No patient file, consultation fee or queue token.</p>
    <form onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <div className="field"><label className="field-label" htmlFor="pharmacy-name">Customer name</label><Input id="pharmacy-name" value={name} maxLength={200} required autoFocus onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label><input type="checkbox" checked={verified} required onChange={(e) => setVerified(e.target.checked)} /> I visually verified the prescription for these supplied medicines.</label></div>
      {!medicines?.length && <p className="field-hint">Confirm medicine units and prices under Stock first.</p>}
      {items.map((item, index) => <div className="field" key={index}>
        <label className="field-label" htmlFor={`pharmacy-medicine-${index}`}>Medicine {index + 1}</label>
        <Select value={item.medicineId} onValueChange={(medicineId) => setItems((old) => old.map((i, n) => n === index ? { ...i, medicineId } : i))}><SelectTrigger id={`pharmacy-medicine-${index}`}><SelectValue placeholder="Choose medicine" /></SelectTrigger><SelectContent>{(medicines ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.name} · {formatPaise(m.price_paise)} / {m.stock_unit}</SelectItem>)}</SelectContent></Select>
        <label className="field-label" htmlFor={`pharmacy-quantity-${index}`}>Quantity supplied ({medicines?.find((m) => m.id === item.medicineId)?.stock_unit ?? 'choose medicine'})</label>
        <Input id={`pharmacy-quantity-${index}`} type="number" min="1" step="1" required value={item.quantity} onChange={(e) => setItems((old) => old.map((i, n) => n === index ? { ...i, quantity: e.target.value } : i))} />
        {items.length > 1 && <Button type="button" variant="secondary" onClick={() => setItems((old) => old.filter((_, n) => n !== index))}>Remove medicine {index + 1}</Button>}
      </div>)}
      <div className="action-row"><Button type="button" variant="secondary" onClick={() => setItems((old) => [...old, { medicineId: '', quantity: '' }])}>Add medicine</Button></div>
      <p className="pricing-value">Total {formatPaise(draftTotal)}</p>
      {save.error && <p className="form-error">{save.error.message}</p>}
      {medicineError && <p className="form-error">Couldn't load medicines.</p>}
      <div className="action-row"><Button type="submit" disabled={save.isPending}>Prepare bill</Button><Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancel</Button></div>
    </form>
  </div>
  function selectedPanel() {
    if (!selected) return null
    const lines = selected.bills?.bill_line_items ?? selected.pharmacy_sale_items
    const total = lines.reduce((sum, l) => sum + l.line_total_paise, 0)
    return <div className="admin-page">
      <Button type="button" variant="secondary" onClick={() => setSelectedId(null)}>Back to pharmacy bills</Button>
      <h2 className="readout-heading">{selected.customer_name}</h2>
      <p>{selected.bill_id ? (selected.pending ? 'Payment recorded on this device—Not saved yet' : `Paid via ${selected.bills?.payment_method ?? 'saved payment'}`) : (selected.pending ? 'Bill prepared—Not saved yet' : 'Awaiting payment')}</p>
      <ul className="past-visit-list">{lines.map((line, n) => <li key={n} className="past-visit-item bill-item-row"><span>{line.description} × {line.quantity} {line.stock_unit}</span><span className="pricing-value">{formatPaise(line.line_total_paise)}</span></li>)}</ul>
      <p>Calculated total {formatPaise(total)} · Discount {formatPaise(total - selected.final_amount_paise)}</p><p className="pricing-value">Payable {formatPaise(selected.final_amount_paise)}</p>
      {isDoctor && <form onSubmit={(e) => { e.preventDefault(); discount.mutate() }}><div className="field"><label className="field-label" htmlFor="pharmacy-final">Doctor's final payable (₹)</label><Input id="pharmacy-final" inputMode="decimal" value={finalInput} required onChange={(e) => setFinalInput(e.target.value)} /></div><Button type="submit" disabled={discount.isPending}>{selected.bill_id ? 'Record correction' : 'Set payable'}</Button>{selected.bill_id && <p className="field-hint">Creates a correction bill. Handle any refund or additional collection separately.</p>}</form>}
      {!isDoctor && !selected.bill_id && <div className="action-row"><label htmlFor="pharmacy-payment">Payment method</label><div className="text-toggles" id="pharmacy-payment" aria-label="Payment method">{["cash", "upi"].map(value => <button key={value} type="button" aria-pressed={method === value} onClick={() => setMethod(value)}>{value === "cash" ? "Cash" : "UPI"}</button>)}</div><Button type="button" disabled={confirm.isPending} onClick={() => confirm.mutate()}>Confirm payment</Button></div>}
      {confirm.error && <p className="form-error">{confirm.error.message}</p>}{discount.error && <p className="form-error">{discount.error.message}</p>}
      {print.isError && <p className="form-error" role="alert">{print.error.message}</p>}
      {selected.bills && <><DocumentArchives clinicId={clinicId} billId={selected.bills.id} /><Button type="button" variant="dark" disabled={print.isPending} onClick={() => print.mutate()}>Print receipt</Button><div className="print-area"><PrintableReceipt clinic={clinic} customerName={selected.customer_name} billable={lines} amountPaise={selected.bills.final_amount_paise} discountPaise={total - selected.bills.final_amount_paise} bill={selected.bills} /></div></>}
    </div>
  }
  const listPanel = <div className="admin-page">
    <div className="admin-toolbar"><h2 className="readout-heading">Refills</h2><Button type="button" onClick={openNew}>New pharmacy bill</Button></div>
    <div className="field"><label className="field-label" htmlFor="pharmacy-search">Find bills by customer name</label><Input id="pharmacy-search" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(50); setSelectedId(null) }} /></div>
    {salesError && <p className="form-error">Couldn't load pharmacy bills.</p>}
    <p className="field-hint">These names are not linked to patient histories.</p>
    <ul className="past-visit-list">{(sales ?? []).map((s) => <li key={s.id} className="past-visit-item"><Button type="button" variant="secondary" onClick={() => { setSelectedId(s.id); confirm.reset(); discount.reset(); setFinalInput('') }}>{s.customer_name} · {formatDate(s.created_at)} · {formatPaise(s.final_amount_paise)} · {s.bill_id ? 'Paid' : 'Awaiting payment'}{s.pending ? ' · Not saved yet' : ''}</Button></li>)}</ul>
    {(sales?.length ?? 0) >= limit && <Button variant="secondary" onClick={() => setLimit(value => value + 50)}>Show more</Button>}
  </div>
  return <div className="refill-workspace"><div className="refill-editor">{creating ? createPanel : selected ? selectedPanel() : listPanel}</div>
    <aside className="refill-recent"><p className="field-hint">Recent refill bills</p>{(sales ?? []).slice(0, 10).map(s => <button key={s.id} className="record-selector" aria-pressed={selectedId === s.id} onClick={() => { setSelectedId(s.id); setCreating(false); confirm.reset(); discount.reset(); setFinalInput('') }}><strong>{s.customer_name}</strong><span>{formatPaise(s.final_amount_paise)}</span><small>{s.bill_id ? 'Paid' : 'Awaiting payment'} · {formatDate(s.created_at)}{s.pending ? ' · Not saved yet' : ''}</small></button>)}
    <div className="refill-rules"><p className="field-hint">Refill workflow</p><p>Visually verify the prescription, enter the name and medicines supplied. No queue token or consultation fee.</p><p>Catalog prices are shared. Only the doctor can give a discount.</p></div></aside>
  </div>

}
