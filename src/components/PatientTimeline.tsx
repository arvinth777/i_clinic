import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDateOnly, formatDateTime } from '../lib/date'
import { formatPaise } from '../lib/money'
import { buildTimeline, type TimelineBill } from '../lib/patientTimeline'
import { Button } from './ui/button'
import { LoadingRows, QueryError } from './QueryState'

type Visit = { id: string; arrived_at: string; complaint: string; token_number: number }
type Prescription = { id: string; visit_id: string; created_at: string; diagnosis: string | null }
type File = { id: string; title: string; category: string; examination_date: string | null; created_at: string; status: string }
const KIND_LABEL = { visit: 'Visit', prescription: 'Prescription', payment: 'Payment', upload: 'Document' }

// Doctor only: prescriptions and documents are doctor-readable, so the combined view is too.
export function PatientTimeline({ clinicId, patientId, visits, prescriptions, onReceipt, onDocuments }: { clinicId: string; patientId: string; visits: Visit[] | undefined; prescriptions: Prescription[] | undefined; onReceipt: (visitId: string) => void; onDocuments: () => void }) {
  const bills = useQuery({
    queryKey: ['patient-timeline-bills', clinicId, patientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('bills').select('id, visit_id, final_amount_paise, payment_method, confirmed_at, corrects_bill_id, bill_settlements(payment_method, settled_at), visits!inner(patient_id)').eq('clinic_id', clinicId).eq('visits.patient_id', patientId)
      if (error) throw error
      return data as unknown as TimelineBill[]
    },
  })
  const files = useQuery({
    queryKey: ['patient-timeline-files', clinicId, patientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('patient_files').select('id, title, category, examination_date, created_at, status').eq('clinic_id', clinicId).eq('patient_id', patientId)
      if (error) throw error
      return data as File[]
    },
  })
  const events = useMemo(() => (visits && prescriptions && bills.data && files.data ? buildTimeline({ visits, prescriptions, bills: bills.data, files: files.data }) : null), [visits, prescriptions, bills.data, files.data])
  if (bills.isError || files.isError) return <QueryError retry={() => { void bills.refetch(); void files.refetch() }} />
  if (!events) return <LoadingRows label="Loading timeline…" />
  return <div className="patient-history patient-timeline">
    <p className="field-hint">Everything recorded for this patient, newest first. Times are clinic time (IST).</p>
    {events.map(e => <article key={e.key} className="history-row"><div><time dateTime={e.at}>{formatDateTime(e.at)}</time><p className="field-hint">{KIND_LABEL[e.kind]}</p></div><div>
      <h3>{e.title}</h3>
      {e.detail && <p>{e.detail}</p>}
      {e.amountPaise != null && <p>{formatPaise(e.amountPaise)}</p>}
      {e.examinationDate && <p className="field-hint">Examination date {formatDateOnly(e.examinationDate)} (date only)</p>}
      {e.kind === 'payment' && e.visitId && <Button variant="ghost" onClick={() => onReceipt(e.visitId!)}>View receipt →</Button>}
      {e.kind === 'upload' && <Button variant="ghost" onClick={onDocuments}>Open in Documents →</Button>}
    </div></article>)}
    {events.length === 0 && <p className="readout-empty">Nothing recorded for this patient yet.</p>}
  </div>
}
