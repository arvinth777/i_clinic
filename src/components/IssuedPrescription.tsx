import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { readPrescriptionPrint, savePrescriptionPrint, type PrescriptionPrintSnapshot } from '../lib/prescriptionPrint'
import { formatDateOnly } from '../lib/date'
import { usePrintDocument } from '../lib/usePrintDocument'
import { PrintablePrescription, type ClinicPrintInfo, type DetailRow, type PrintVisit } from './VisitPrintout'
import { LetterheadPreview } from './LetterheadPreview'
import { LoadingRows, QueryError } from './QueryState'
import { Button } from './ui/button'
import { DriveCheck } from './DriveCheck'
import './PrescriptionForm.css'

export function IssuedPrescription({ userId, clinicId, visitId }: { userId: string; clinicId: string; visitId: string }) {
  const print = usePrintDocument(`${clinicId}:${visitId}`)
  const local = useQuery({
    queryKey: ['prescription-print', userId, clinicId, visitId], networkMode: 'always',
    queryFn: async () => await readPrescriptionPrint(userId, clinicId, visitId) ?? null,
  })
  const issued = useQuery({
    queryKey: ['issued-prescription', userId, clinicId, visitId],
    enabled: local.isSuccess && !local.data,
    queryFn: async () => {
      const [visitResult, clinicResult, detailResult, clinicalResult] = await Promise.all([
        supabase.from('visits')
          .select('id, token_number, stage, arrived_at, consultation_ended_at, complaint, follow_up_date, patients(name, age, gender, height_cm, weight_kg)')
          .eq('clinic_id', clinicId).eq('id', visitId).single(),
        supabase.from('clinics')
          .select('name, upi_vpa, doctor_name, doctor_registration_number, address, phone')
          .eq('id', clinicId).single(),
        supabase.rpc('get_visit_billing_detail', { p_visit_id: visitId }),
        supabase.from('prescriptions').select('id, diagnosis, advice').eq('clinic_id', clinicId).eq('visit_id', visitId).order('created_at'),
      ])
      for (const result of [visitResult, clinicResult, detailResult, clinicalResult]) if (result.error) throw result.error
      const detail = detailResult.data as DetailRow[] | null
      if (!detail?.some(row => row.kind === 'medicine')) throw new Error('The issued prescription copy is not available.')
      const clinical = clinicalResult.data ?? []
      const snapshot: PrescriptionPrintSnapshot = {
        visit: { ...visitResult.data as unknown as PrintVisit,
          diagnosis: [...new Set(clinical.map(row => row.diagnosis).filter(Boolean))].join('\n'),
          advice: [...new Set(clinical.map(row => row.advice).filter(Boolean))].join('\n') },
        clinic: clinicResult.data as ClinicPrintInfo,
        medicines: detail.filter(row => row.kind === 'medicine'), prescriptionIds: clinical.map(row => row.id),
      }
      await savePrescriptionPrint(userId, clinicId, snapshot)
      return snapshot
    },
  })
  const snapshot = local.data ?? issued.data
  return <div className="rx-workspace"><div className="rx-editor">
    <h2 className="readout-heading">Issued prescription</h2>
    <p className="field-hint">Read-only · the prescription sent to reception.</p>
    {issued.isError && <QueryError retry={() => void issued.refetch()} savedAt={issued.dataUpdatedAt || local.dataUpdatedAt} />}
    {local.isError && <p className="form-error" role="alert">Could not read the print copy saved on this device.</p>}
    {!snapshot && (issued.isFetching || local.isPending) && <LoadingRows label="Loading issued prescription…" />}
    {!snapshot && !issued.isFetching && !local.isPending && <p className="field-hint">No print copy is saved on this device. Connect once to load this prescription.</p>}
    {snapshot && <div>
      <div className="rx-patient"><h2>{snapshot.visit.patients?.name}</h2><p>Token #{snapshot.visit.token_number}</p></div>
      {snapshot.visit.complaint && <p><strong>Complaints: </strong>{snapshot.visit.complaint}</p>}
      {snapshot.visit.diagnosis && <p className="prescription-note"><strong>Diagnosis: </strong>{snapshot.visit.diagnosis}</p>}
      <ul className="review-list">{snapshot.medicines.map((medicine, index) => <li className="review-item" key={index}>
        <span className="review-item-name">{medicine.description} {medicine.strength}</span>
        <p>{[medicine.drug_type, medicine.dosage_frequency, medicine.before_after_food, medicine.duration_days ? `${medicine.duration_days} days` : ''].filter(Boolean).join(' · ')}</p>
        {medicine.notes && <p className="review-item-note">{medicine.notes}</p>}
      </li>)}</ul>
      {snapshot.visit.advice && <p className="prescription-note"><strong>Advice / investigations: </strong>{snapshot.visit.advice}</p>}
      {snapshot.visit.follow_up_date && <p>Review: {formatDateOnly(snapshot.visit.follow_up_date)}</p>}
      <Button disabled={print.isPending} onClick={() => print.mutate()}>Print prescription</Button>
      <DriveCheck clinicId={clinicId} kind="prescription" visitId={visitId} />
      <div className="print-area"><PrintablePrescription clinic={snapshot.clinic} visit={snapshot.visit} medicines={snapshot.medicines} /></div>
    </div>}
    {print.isError && <p className="form-error" role="alert">{print.error.message}</p>}
  </div>{snapshot && <LetterheadPreview><PrintablePrescription clinic={snapshot.clinic} visit={snapshot.visit} medicines={snapshot.medicines} /></LetterheadPreview>}</div>
}
