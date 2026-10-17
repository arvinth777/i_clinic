import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { readPrescriptionPrint, savePrescriptionPrint, type PrescriptionPrintSnapshot } from '../lib/prescriptionPrint'
import { usePrintDocument } from '../lib/usePrintDocument'
import { PrintablePrescription, type ClinicPrintInfo, type DetailRow, type PrintVisit } from './VisitPrintout'
import { LetterheadPreview } from './LetterheadPreview'
import { LoadingRows, QueryError } from './QueryState'
import { Button } from './ui/button'
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
      const [visitResult, clinicResult, approvalResult, clinicalResult] = await Promise.all([
        supabase.from('visits')
          .select('id, token_number, stage, arrived_at, complaint, follow_up_date, patients(name, age, gender, height_cm, weight_kg)')
          .eq('clinic_id', clinicId).eq('id', visitId).single(),
        supabase.from('clinics')
          .select('name, upi_vpa, doctor_name, doctor_registration_number, address, phone')
          .eq('id', clinicId).single(),
        supabase.rpc('get_approved_bill', { p_visit_id: visitId }),
        supabase.from('prescriptions').select('id, diagnosis, advice').eq('clinic_id', clinicId).eq('visit_id', visitId).order('created_at'),
      ])
      for (const result of [visitResult, clinicResult, approvalResult, clinicalResult]) if (result.error) throw result.error
      const detail = (approvalResult.data as { lines: DetailRow[] } | null)?.lines
      if (!detail) throw new Error('The approved prescription copy is not available.')
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
      <Button disabled={print.isPending} onClick={() => print.mutate()}>Print prescription</Button>
      <div className="print-area"><PrintablePrescription clinic={snapshot.clinic} visit={snapshot.visit} medicines={snapshot.medicines} /></div>
    </div>}
    {print.isError && <p className="form-error" role="alert">{print.error.message}</p>}
  </div>{snapshot && <LetterheadPreview><PrintablePrescription clinic={snapshot.clinic} visit={snapshot.visit} medicines={snapshot.medicines} /></LetterheadPreview>}</div>
}
