import { createStore, get, set } from 'idb-keyval'
import type { DraftItem } from './prescriptionDraft'
import type { ClinicPrintInfo, DetailRow, PrintVisit } from '../components/VisitPrintout'

export type PrescriptionPrintSnapshot = { visit: PrintVisit; clinic?: ClinicPrintInfo; medicines: DetailRow[]; prescriptionIds: string[] }
const store = createStore('prescription-print-db', 'prescriptions')
const key = (ownerId: string, clinicId: string, visitId: string) => `${ownerId}:${clinicId}:${visitId}`

// Retrying edited instructions replaces this prescription, preserving the others.
export function mergePrescriptionPrint(previous: PrescriptionPrintSnapshot, current: PrescriptionPrintSnapshot): PrescriptionPrintSnapshot {
  return {
    ...current,
    medicines: [...previous.medicines.filter((row) => !row.prescription_id || !current.prescriptionIds.includes(row.prescription_id)), ...current.medicines],
    prescriptionIds: [...new Set([...previous.prescriptionIds, ...current.prescriptionIds])],
  }
}

export const readPrescriptionPrint = (ownerId: string, clinicId: string, visitId: string) => get<PrescriptionPrintSnapshot>(key(ownerId, clinicId, visitId), store)
export const savePrescriptionPrint = (ownerId: string, clinicId: string, snapshot: PrescriptionPrintSnapshot) => set(key(ownerId, clinicId, snapshot.visit.id), snapshot, store)

export type PrescriptionDraft = { items: DraftItem[]; diagnosis: string; advice: string }
export const readPrescriptionDraft = (ownerId: string, clinicId: string, visitId: string) => get<PrescriptionDraft>(`draft:${key(ownerId, clinicId, visitId)}`, store)
export const savePrescriptionDraft = (ownerId: string, clinicId: string, visitId: string, draft: PrescriptionDraft) => set(`draft:${key(ownerId, clinicId, visitId)}`, draft, store)
