import { formatPaise } from '../lib/money'
import { formatDate, formatDateOnly } from '../lib/date'
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
  // Plain and transactional on purpose -- a payment record, not a
  // doctor's document. Clinic name/address/phone are legitimate on a
  // receipt (a real business's contact details); the doctor's name and
  // registration number are not (that's a medical credential, and has
  // nothing to do with who took the payment).
  return (
    <section className="print-page print-page-plain">
      <h1>{clinic?.name}</h1>
      {(clinic?.address || clinic?.phone) && <p className="print-contact-line">{[clinic?.address, clinic?.phone].filter(Boolean).join(' · ')}</p>}
      <p>
        {visit ? `${visit.patients?.name} — Token ${visit.token_number} — ${formatDate(visit.arrived_at)}` : customerName}
      </p>

      <h2>Receipt</h2>
      <table className="print-table">
        <tbody>
          {billable.map((r, i) => (
            <tr key={i}>
              <td>{r.description}{r.quantity != null && ` × ${r.quantity} ${r.stock_unit ?? ''}`}{'shortfall' in r && !!r.shortfall && <small> · {r.shortfall} not supplied</small>}</td>
              <td>{formatPaise(r.line_total_paise ?? r.unit_price_paise)}</td>
            </tr>
          ))}
          <tr>
            <td>Discount</td>
            <td>{formatPaise(discountPaise)}</td>
          </tr>
          <tr className="print-total-row">
            <td>{bill ? 'Amount paid' : 'Total'}</td>
            <td>{formatPaise(amountPaise)}</td>
          </tr>
        </tbody>
      </table>
      <div className="receipt-end">
        {!bill && <p>Not paid yet</p>}
        {bill?.pending && <p>Payment recorded on this device—not saved yet.</p>}
        {bill && <p>Paid via {bill.payment_method} on {formatDate(bill.confirmed_at)}</p>}
        <p className="receipt-medicine-notice">Prescribed drugs are for the specified condition and period only; do not self-medicate.<br /><span lang="ta">குறிப்பிட்ட நோய்நிலைக்கும் காலத்திற்கும் மட்டுமே இந்த மருந்துகள் பரிந்துரைக்கப்பட்டுள்ளன. மருத்துவரின் ஆலோசனையின்றி மருந்துகளை உட்கொள்ள வேண்டாம்.</span></p>
      </div>
    </section>
  )
}
