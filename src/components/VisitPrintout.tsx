import { formatPaise } from '../lib/money'
import { formatDate } from '../lib/date'
import './Billing.css'

export type PrintVisit = {
  id: string
  token_number: number
  stage: string
  arrived_at: string
  patients: { name: string } | null
}

export type DetailRow = {
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

export type BillLine = { stock_unit?: string | null; kind: DetailRow['kind']; description: string; quantity: number; unit_price_paise: number; line_total_paise: number }

export type Bill = { bill_line_items?: BillLine[]; id: string; final_amount_paise: number; payment_method: string; confirmed_at: string; pending?: boolean }

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
  // User-supplied reference: a hospital letterhead template (colour bar
  // top and bottom, clinic/doctor block, a repeated footer). This is the
  // one of the two documents that's actually a doctor's letterhead
  // document -- contrast DocumentsPanel's PrintableDocument, which
  // deliberately omits the clinic name because IT assumes real
  // pre-printed letterhead paper; this one renders its own.
  return (
    <section className="print-page print-page-letterhead">
      <div className="print-bar" />
      <div className="print-content">
        <header className="print-letterhead">
          <h1>{clinic?.name}</h1>
          {clinic?.doctor_name && (
            <p className="print-doctor-line">
              {clinic.doctor_name}
              {clinic.doctor_registration_number ? ` — Reg. No. ${clinic.doctor_registration_number}` : ''}
            </p>
          )}
          {(clinic?.address || clinic?.phone) && (
            <p className="print-contact-line">{[clinic?.address, clinic?.phone].filter(Boolean).join(' · ')}</p>
          )}
        </header>

        <p>
          {visit.patients?.name} — Token {visit.token_number} — {formatDate(visit.arrived_at)}
        </p>

        <h2>Prescription</h2>
        {medicines.length === 0 ? (
          <p>No medicines prescribed.</p>
        ) : (
          <table className="print-table">
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Type</th>
                <th>Strength</th>
                <th>Frequency</th>
                <th>Food</th>
                <th>Duration</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {medicines.map((m, i) => (
                <tr key={i}>
                  <td>{m.description}</td>
                  <td>{m.drug_type}</td>
                  <td>{m.strength}</td>
                  <td>{m.dosage_frequency}</td>
                  <td>{m.before_after_food}</td>
                  <td>{m.duration_days} days</td>
                  <td>{m.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <footer className="print-footer">
          <p>{[clinic?.name, clinic?.address].filter(Boolean).join(' · ')}</p>
          {clinic?.phone && <p>{clinic.phone}</p>}
        </footer>
      </div>
      <div className="print-bar" />
    </section>
  )
}

function PrintableReceipt({
  clinic,
  visit,
  billable,
  amountPaise,
  discountPaise,
  bill,
}: {
  clinic: ClinicPrintInfo | undefined
  visit: PrintVisit
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
        {visit.patients?.name} — Token {visit.token_number} — {formatDate(visit.arrived_at)}
      </p>

      <h2>Receipt</h2>
      <table className="print-table">
        <tbody>
          {billable.map((r, i) => (
            <tr key={i}>
              <td>{r.description}{r.quantity != null && ` × ${r.quantity} ${r.stock_unit ?? ''}`}</td>
              <td>{formatPaise(r.line_total_paise ?? r.unit_price_paise)}</td>
            </tr>
          ))}
          <tr>
            <td>Discount</td>
            <td>{formatPaise(discountPaise)}</td>
          </tr>
          <tr className="print-total-row">
            <td>Amount paid</td>
            <td>{formatPaise(amountPaise)}</td>
          </tr>
        </tbody>
      </table>
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
