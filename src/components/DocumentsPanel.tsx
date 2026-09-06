import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDate, formatDateOnly } from '../lib/date'

type DocType = 'certificate' | 'sick_leave' | 'referral'

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: 'certificate', label: 'Certificate' },
  { value: 'sick_leave', label: 'Sick leave' },
  { value: 'referral', label: 'Referral' },
]

type IssuedDoc = {
  document_type: DocType
  purpose: string | null
  rest_from: string | null
  rest_to: string | null
  reason: string | null
  referred_to: string | null
  case_summary: string | null
  issued_at: string
}

// Printed on clinic letterhead -- unlike the receipt/prescription slip
// (Billing.tsx's PrintableSlip), this deliberately does not print the
// clinic name: real letterhead stationery already carries it. What it
// does need, per the PRD, is the doctor's signature line.
function PrintableDocument({ doc, patientName, patientAge, doctorName, doctorRegNo }: { doc: IssuedDoc | null; patientName: string; patientAge: number | null; doctorName: string | null; doctorRegNo: string | null }) {
  if (!doc) return null
  return (
    <div className="print-area">
      {doc.document_type === 'certificate' && (
        <>
          <h1>Medical Certificate</h1>
          <p>
            This is to certify that {patientName}
            {patientAge != null ? `, aged ${patientAge},` : ''} was examined by the undersigned for the purpose of: {doc.purpose}.
          </p>
        </>
      )}
      {doc.document_type === 'sick_leave' && (
        <>
          <h1>Sick Leave Note</h1>
          <p>
            This is to certify that {patientName} is advised rest from {doc.rest_from ? formatDateOnly(doc.rest_from) : ''} to {doc.rest_to ? formatDateOnly(doc.rest_to) : ''}, on account of: {doc.reason}.
          </p>
        </>
      )}
      {doc.document_type === 'referral' && (
        <>
          <h1>Referral Letter</h1>
          <p>
            Referring {patientName} to {doc.referred_to} for: {doc.reason}.
          </p>
          <p>Case summary: {doc.case_summary}</p>
        </>
      )}
      <p>Date: {formatDate(doc.issued_at)}</p>
      <p>
        {doctorName || 'Doctor'}
        {doctorRegNo ? ` — Reg. No. ${doctorRegNo}` : ''}
      </p>
    </div>
  )
}

export function DocumentsPanel({ clinicId, visitId, patientName, patientAge, complaint, issuedBy }: { clinicId: string; visitId: string; patientName: string; patientAge: number | null; complaint: string; issuedBy: string }) {
  const [docType, setDocType] = useState<DocType>('certificate')
  const [purpose, setPurpose] = useState('')
  const [restFrom, setRestFrom] = useState('')
  const [restTo, setRestTo] = useState('')
  const [reason, setReason] = useState('')
  const [referredTo, setReferredTo] = useState('')
  const [caseSummary, setCaseSummary] = useState(complaint)
  const [issued, setIssued] = useState<IssuedDoc | null>(null)

  const { data: clinicInfo } = useQuery({
    queryKey: ['clinic-doctor-info', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clinics').select('doctor_name, doctor_registration_number').eq('id', clinicId).single()
      if (error) throw error
      return data as { doctor_name: string | null; doctor_registration_number: string | null }
    },
  })

  const issue = useMutation({
    mutationFn: async () => {
      const row = {
        clinic_id: clinicId,
        visit_id: visitId,
        document_type: docType,
        purpose: docType === 'certificate' ? purpose : null,
        rest_from: docType === 'sick_leave' ? restFrom : null,
        rest_to: docType === 'sick_leave' ? restTo : null,
        reason: docType === 'sick_leave' || docType === 'referral' ? reason : null,
        referred_to: docType === 'referral' ? referredTo : null,
        case_summary: docType === 'referral' ? caseSummary : null,
        issued_by: issuedBy,
      }
      const { data, error } = await supabase.from('clinic_documents').insert(row).select('document_type, purpose, rest_from, rest_to, reason, referred_to, case_summary, issued_at').single()
      if (error) throw error
      return data as IssuedDoc
    },
    onSuccess: (doc) => {
      setIssued(doc)
      // Print stays DOM-based: the mutation already completed and its
      // result is in local state, so this reads nothing further over
      // the network (same idiom as Billing.tsx's confirm-then-print).
      setTimeout(() => window.print(), 100)
    },
  })

  return (
    <section className="record-section">
      <h3 className="readout-heading">Documents</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          issue.mutate()
        }}
      >
        <div className="payment-method-row">
          {DOC_TYPES.map((t) => (
            <label key={t.value} className="payment-method-option">
              <input type="radio" name="doc-type" checked={docType === t.value} onChange={() => setDocType(t.value)} />
              {t.label}
            </label>
          ))}
        </div>

        {docType === 'certificate' && (
          <div className="field">
            <label className="field-label" htmlFor="doc-purpose">
              Purpose
            </label>
            <input id="doc-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} required />
          </div>
        )}

        {docType === 'sick_leave' && (
          <>
            <div className="field">
              <label className="field-label" htmlFor="doc-rest-from">
                Rest from
              </label>
              <input id="doc-rest-from" type="date" value={restFrom} onChange={(e) => setRestFrom(e.target.value)} required />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="doc-rest-to">
                Rest to
              </label>
              <input id="doc-rest-to" type="date" value={restTo} onChange={(e) => setRestTo(e.target.value)} required />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="doc-reason-sick">
                Reason
              </label>
              <input id="doc-reason-sick" value={reason} onChange={(e) => setReason(e.target.value)} required />
            </div>
          </>
        )}

        {docType === 'referral' && (
          <>
            <div className="field">
              <label className="field-label" htmlFor="doc-referred-to">
                Referred to
              </label>
              <input id="doc-referred-to" value={referredTo} onChange={(e) => setReferredTo(e.target.value)} required />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="doc-reason-referral">
                Reason
              </label>
              <input id="doc-reason-referral" value={reason} onChange={(e) => setReason(e.target.value)} required />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="doc-case-summary">
                Case summary
              </label>
              <textarea id="doc-case-summary" value={caseSummary} onChange={(e) => setCaseSummary(e.target.value)} rows={3} />
            </div>
          </>
        )}

        <div className="action-row">
          <button type="submit" className="secondary-button" disabled={issue.isPending}>
            {issue.isPending ? 'Issuing…' : 'Issue & print'}
          </button>
        </div>
        {issue.isError && <p className="form-error">Couldn't save — try again.</p>}
        {issued && <p className="readout-empty">Issued and sent to print.</p>}
      </form>

      <PrintableDocument doc={issued} patientName={patientName} patientAge={patientAge} doctorName={clinicInfo?.doctor_name ?? null} doctorRegNo={clinicInfo?.doctor_registration_number ?? null} />
    </section>
  )
}
