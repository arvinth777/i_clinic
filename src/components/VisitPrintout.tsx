import { amountInWords, formatRupees } from '../lib/money'
import { formatDate, formatDateOnly, formatDateTime } from '../lib/date'
import { formatBody } from '../lib/patientBody'
import './Billing.css'
import { PrescriptionLetterhead } from './PrescriptionLetterhead'

export type PrintVisit = {
  discount_requested_at?: string | null
  id: string
  token_number: number
  stage: string
  arrived_at: string
  prescribed_at?: string | null
  consultation_ended_at?: string | null
  complaint?: string
  diagnosis?: string | null
  advice?: string | null
  follow_up_date?: string | null
  patients: { name: string; age?: number | null; gender?: string | null; height_cm?: number | null; weight_kg?: number | null } | null
}
export type DetailRow = {
  prescription_item_id?: string
  approved_quantity?: number
  available_quantity?: number
  shortfall?: number
  diagnosis?: string | null
  advice?: string | null
  prescription_id?: string
  kind: 'consultation' | 'procedure' | 'medicine'
  description: string
  unit_price_paise: number
  quantity?: number
  stock_unit?: string | null
  line_total_paise?: number
  drug_type: string | null
  strength: string | null
  before_after_food: string | null
  dosage_frequency: string | null
  duration_days: number | null
  notes: string | null
}

export type BillLine = { prescription_item_id?: string; available_quantity?: number; approved_quantity?: number; shortfall?: number; stock_unit?: string | null; kind: DetailRow['kind']; description: string; quantity: number; unit_price_paise: number; line_total_paise: number }

export type Bill = { approved_discount_paise?: number; bill_line_items?: BillLine[]; id: string; final_amount_paise: number; payment_method: string; confirmed_at: string; pending?: boolean }

export type ClinicPrintInfo = {
  name: string
  upi_vpa: string | null
  doctor_name: string | null
  doctor_registration_number: string | null
  address: string | null
  phone: string | null
}

// The doctor prints the A4 prescription and reception prints the receipt separately.
export function PrintablePrescription({ clinic, visit, medicines }: { clinic: ClinicPrintInfo | undefined; visit: PrintVisit; medicines: DetailRow[] }) {
  return (
    <section className="print-page prescription-sheet">
      <PrescriptionLetterhead />
      <table className="prescription-paper-content">
        <thead><tr><td colSpan={2}>
          <div className="prescription-header-space" />
          <div className="prescription-reference"><span>Ref. #{visit.token_number}</span><span>Date: {formatDate(visit.consultation_ended_at ?? visit.prescribed_at ?? visit.arrived_at)}</span></div>
        </td></tr></thead>
        <tbody>
          <tr><td colSpan={2}><div className="prescription-patient"><strong>Patient: {visit.patients?.name}</strong><span>{[visit.patients?.age != null ? `${visit.patients.age} years` : '', visit.patients?.gender, formatBody(visit.patients?.height_cm, visit.patients?.weight_kg)].filter(Boolean).join(' · ')}</span></div></td></tr>
          <tr><td colSpan={2} className="prescription-rx">℞</td></tr>
          <tr className="prescription-column-labels"><td>Medicine / strength</td><td>Dosage · duration</td></tr>
          {medicines.length === 0 ? <tr><td colSpan={2}>No medicines added.</td></tr> : medicines.map((m, i) => (
            <tr className="prescription-medicine" key={i}>
              <td><strong>{i + 1}. {m.description} {m.strength}</strong>{m.drug_type && <span> · {m.drug_type}</span>}{m.notes && <p>{m.notes}</p>}</td>
              <td><strong>{m.dosage_frequency}</strong><p>{[m.before_after_food, m.duration_days ? `For ${m.duration_days} days` : ''].filter(Boolean).join(' · ')}</p></td>
            </tr>
          ))}
          {visit.advice && <tr><td colSpan={2} className="prescription-note"><strong>Advice / investigations: </strong>{visit.advice}</td></tr>}
          {visit.diagnosis && <tr><td colSpan={2} className="prescription-note"><strong>Diagnosis: </strong>{visit.diagnosis}</td></tr>}
          <tr className="prescription-fill"><td colSpan={2} /></tr>
        </tbody>
        <tfoot><tr><td colSpan={2}><div className="prescription-signature"><span>Review: {visit.follow_up_date ? formatDateOnly(visit.follow_up_date) : '—'}</span><span>{clinic?.doctor_name}<br />Signature / {clinic?.doctor_registration_number || 'Registration No.'}</span></div></td></tr><tr><td colSpan={2}><div className="prescription-footer-space" /></td></tr></tfoot>
      </table>
    </section>
  )
}

export function PrintableReceipt({
  clinic,
  visit,
  customerName,
  billable,
  amountPaise,
  discountPaise,
  bill,
}: {
  clinic: ClinicPrintInfo | undefined
  visit?: PrintVisit
  customerName?: string
  billable: (DetailRow | BillLine)[]
  amountPaise: number
  discountPaise: number
  bill: Bill | null
}) {
  // A medicine bill, not a doctor's document: clinic name, address and phone are fine; the doctor's name and registration
  // number are not, and neither are consultation or procedure fees (the doctor's charges are collected on screen, never printed).
  // Black on white, solid rules, em units: it must print cleanly on 10 x 12 in dot-matrix stock and look the same in the
  // on-screen preview and the archived PDF.
  const when = bill?.confirmed_at ?? visit?.arrived_at
  const rows = billable.filter(row => row.kind !== 'consultation' && row.kind !== 'procedure').map(row => {
    const quantity = row.quantity ?? 1, amount = row.line_total_paise ?? row.unit_price_paise * quantity
    return { row, quantity, rate: quantity ? Math.round(amount / quantity) : row.unit_price_paise, amount }
  }).filter(r => r.quantity > 0)
  const subtotal = rows.reduce((sum, r) => sum + r.amount, 0)
  // With fee lines hidden the printed total is the medicines alone; a saved discount only applies when every line is shown.
  const feesHidden = billable.some(row => row.kind === 'consultation' || row.kind === 'procedure')
  const discount = feesHidden ? 0 : discountPaise
  const total = feesHidden ? subtotal : amountPaise
  const method = bill?.payment_method === 'upi' ? 'UPI' : bill?.payment_method === 'cash' ? 'Cash' : bill?.payment_method
  const patientLine = visit ? [visit.patients?.name, [visit.patients?.age != null ? `${visit.patients.age} yrs` : '', visit.patients?.gender].filter(Boolean).join(' / ')].filter(Boolean).join(', ') : customerName
  return (
    <section className="print-page print-page-plain rcpt">
      <header className="rcpt-head">
        <h1>{clinic?.name}</h1>
        <p>{[clinic?.address, clinic?.phone && `Phone ${clinic.phone}`].filter(Boolean).join('  ·  ')}</p>
      </header>
      <h2 className="rcpt-title">Medicine bill</h2>
      <dl className="rcpt-meta">
        <div className="rcpt-wide"><dt>{visit ? 'Patient' : 'Customer'}</dt><dd>{patientLine}</dd></div>
        <div><dt>Date</dt><dd>{when ? formatDateTime(when) : ''}</dd></div>
        {visit && <div><dt>Token no.</dt><dd>{visit.token_number}</dd></div>}
        {method && <div><dt>Paid by</dt><dd>{method}{bill?.pending && ' (not saved yet)'}</dd></div>}
      </dl>
      <table className="rcpt-items">
        <thead><tr><th>No.</th><th>Medicine</th><th>Qty</th><th>Rate (Rs.)</th><th>Amount (Rs.)</th></tr></thead>
        <tbody>
          {rows.map(({ row, quantity, rate, amount }, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{row.description}</td>
              <td>{quantity}{row.stock_unit ? ` ${row.stock_unit}` : ''}</td>
              <td>{formatRupees(rate)}</td>
              <td>{formatRupees(amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {discount > 0 && <tr><td colSpan={4}>Sub total</td><td>{formatRupees(subtotal)}</td></tr>}
          {discount > 0 && <tr><td colSpan={4}>Discount</td><td>- {formatRupees(discount)}</td></tr>}
          <tr className="rcpt-total"><td colSpan={4}>Total (Rs.)</td><td>{formatRupees(total)}</td></tr>
        </tfoot>
      </table>
      <p className="rcpt-words">{amountInWords(total)}</p>
      <footer className="rcpt-foot">
        <p className="receipt-medicine-notice">Prescribed drugs are for the specified condition and period only; do not self-medicate.<br /><span lang="ta">குறிப்பிட்ட நோய்நிலைக்கும் காலத்திற்கும் மட்டுமே இந்த மருந்துகள் பரிந்துரைக்கப்பட்டுள்ளன. மருத்துவரின் ஆலோசனையின்றி மருந்துகளை உட்கொள்ள வேண்டாம்.</span></p>
        <span className="rcpt-sign">Receiver's signature</span>
      </footer>
    </section>
  )
}
