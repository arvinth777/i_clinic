import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDateOnly, formatDateTime } from '../lib/date'
import { formatPaise } from '../lib/money'
import { buildTimeline, type TimelineBill, type TimelineInput } from '../lib/patientTimeline'
import { Button } from './ui/button'
import { LoadingRows, QueryError } from './QueryState'

type Visit = TimelineInput['visits'][number]
type Prescription = TimelineInput['prescriptions'][number]
type PatientFileRow = TimelineInput['files'][number]
const KIND_LABEL = { visit: 'Visit', prescription: 'Prescription', payment: 'Payment', upload: 'Document' }

// Prescriptions and documents are doctor-readable only, so reception's timeline is visits and payments (no complaint text).
export function PatientTimeline({ clinicId, patientId, isDoctor, visits, prescriptions, onReceipt, onDocuments }: { clinicId: string; patientId: string; isDoctor: boolean; visits: Visit[] | undefined; prescriptions: Prescription[] | undefined; onReceipt: (visitId: string) => void; onDocuments: () => void }) {
  const bills = useQuery({
    queryKey: ['patient-timeline-bills', clinicId, patientId],
    staleTime: 0, // opening the tab always shows the latest bills and settlements
    queryFn: async () => {
      const { data, error } = await supabase.from('bills').select('id, visit_id, final_amount_paise, payment_method, confirmed_at, corrects_bill_id, bill_settlements(payment_method, settled_at), visits!inner(patient_id)').eq('clinic_id', clinicId).eq('visits.patient_id', patientId)
      if (error) throw error
      return data as unknown as TimelineBill[]
    },
  })
  const files = useQuery({
    queryKey: ['patient-files', clinicId, patientId, 'timeline'], // under the prefix a finished upload already invalidates
    enabled: isDoctor,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('patient_files').select('id, title, category, examination_date, created_at, status').eq('clinic_id', clinicId).eq('patient_id', patientId)
      if (error) throw error
      return data as PatientFileRow[]
    },
  })
  const events = useMemo(() => (visits && (prescriptions || !isDoctor) && bills.data && (files.data || !isDoctor) ? buildTimeline({ visits, prescriptions: prescriptions ?? [], bills: bills.data, files: files.data ?? [] }) : null), [isDoctor, visits, prescriptions, bills.data, files.data])
  const failed = bills.isError || files.isError
  if (!events) return failed ? <QueryError retry={() => { void bills.refetch(); void files.refetch() }} /> : <LoadingRows label="Loading timeline…" />
  return <div className="patient-history patient-timeline">
    {failed && <QueryError savedAt={Math.min(bills.dataUpdatedAt, files.dataUpdatedAt)} retry={() => { void bills.refetch(); void files.refetch() }} />}
    <p className="field-hint">Everything recorded for this patient, newest first. Times are clinic time (IST).</p>
    {events.map(e => <article key={e.key} className="history-row"><div><time dateTime={e.at}>{formatDateTime(e.at)}</time><p className="field-hint">{KIND_LABEL[e.kind]}</p></div><div>
      <h3>{e.title}</h3>
      {e.detail && <p>{e.detail}</p>}
      {e.amountPaise != null && <p>{formatPaise(e.amountPaise)}</p>}
      {e.examinationDate && <p className="field-hint">Examination date {formatDateOnly(e.examinationDate)} (date only)</p>}
      {e.kind === 'payment' && e.visitId && <Button variant="ghost" aria-label={`View receipt: ${e.title}`} onClick={() => onReceipt(e.visitId!)}>View receipt →</Button>}
      {e.kind === 'upload' && <Button variant="ghost" aria-label={`Open in Documents: ${e.title}`} onClick={onDocuments}>Open in Documents →</Button>}
    </div></article>)}
    {events.length === 0 && <p className="readout-empty">Nothing recorded for this patient yet.</p>}
  </div>
}
