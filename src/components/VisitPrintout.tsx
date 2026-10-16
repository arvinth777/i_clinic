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

// Two different documents, not one -- a prescription (the doctor's
// document: drugs and dosage, nothing about money) and a bill/receipt
// (the receptionist's document: amounts and payment method, nothing
// about the doctor). User: "is this a prescription or a bill? i think
// you are confusing the both" -- they were right, the two used to be
// stacked on one letterhead-branded page. Now they're two <section>s in
// the same print job (one window.print() still hands over both physical
// pages together, matching the PRD's "prints the receipt with the
// prescription" flow) with a forced page-break between them, each styled
// for what it actually is.
export function PrintablePrescription({ clinic, visit, medicines }: { clinic: ClinicPrintInfo | undefined; visit: PrintVisit; medicines: DetailRow[] }) {
  return (
    <section className="print-page prescription-sheet">
      <PrescriptionLetterhead />
      <table className="prescription-paper-content">
        <thead><tr><td colSpan={2}>
          <div className="prescription-header-space" />
          <div className="prescription-reference"><span>#{visit.token_number}</span><span>{formatDate(visit.arrived_at)}</span></div>
        </td></tr></thead>
        <tbody>
          <tr><td colSpan={2}><div className="prescription-patient"><strong>Patient: {visit.patients?.name}</strong><span>{[visit.patients?.age != null ? `${visit.patients.age} years` : '', visit.patients?.gender, formatBody(visit.patients?.height_cm, visit.patients?.weight_kg)].filter(Boolean).join(' · ')}</span></div></td></tr>
          {visit.complaint && <tr><td colSpan={2} className="prescription-note"><strong>Complaints: </strong>{visit.complaint}</td></tr>}
          {visit.diagnosis && <tr><td colSpan={2} className="prescription-note"><strong>Diagnosis: </strong>{visit.diagnosis}</td></tr>}
          <tr><td colSpan={2} className="prescription-rx">℞</td></tr>
          <tr className="prescription-column-labels"><td>Medicine / strength</td><td>Dosage &amp; duration</td></tr>
          {medicines.length === 0 ? <tr><td colSpan={2}>No medicines added.</td></tr> : medicines.map((m, i) => (
            <tr className="prescription-medicine" key={i}>
              <td><strong>{i + 1}. {m.description} {m.strength}</strong>{m.drug_type && <span> · {m.drug_type}</span>}{m.notes && <p>{m.notes}</p>}</td>
              <td><strong>{m.dosage_frequency}</strong><p>{[m.before_after_food, m.duration_days ? `${m.duration_days} days` : ''].filter(Boolean).join(' · ')}</p></td>
            </tr>
          ))}
          {visit.advice && <tr><td colSpan={2} className="prescription-note"><strong>Advice / investigations: </strong>{visit.advice}</td></tr>}
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
      {!bill && <p>Not paid yet</p>}
      {bill?.pending && <p>Payment recorded on this device—not saved yet.</p>}
      {bill && (
        <p>
          Paid via {bill.payment_method} on {formatDate(bill.confirmed_at)}
        </p>
      )}
    </section>
  )
}

export function PrintableSlip({
  clinic,
  visit,
  detail,
  amountPaise,
  discountPaise,
  bill,
}: {
  clinic: ClinicPrintInfo | undefined
  visit: PrintVisit
  detail: DetailRow[] | undefined
  amountPaise: number
  discountPaise: number
  bill: Bill | null
}) {
  const medicines = detail?.filter((r) => r.kind === 'medicine')
  const billable = bill?.bill_line_items ?? detail ?? []
  const savedDiscount = bill?.bill_line_items ? bill.bill_line_items.reduce((total, line) => total + line.line_total_paise, 0) - bill.final_amount_paise : discountPaise
  return (
    <div className="print-area">
      {medicines ? <PrintablePrescription clinic={clinic} visit={visit} medicines={medicines} /> : <p>Prescription instructions are not available on this device. Print from the doctor’s screen.</p>}
      <PrintableReceipt clinic={clinic} visit={visit} billable={billable} amountPaise={amountPaise} discountPaise={savedDiscount} bill={bill} />
    </div>
  )
}
