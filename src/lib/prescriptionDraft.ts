// Pure draft-item shaping for PrescriptionForm.tsx -- extracted so that
// file stays under the 500-line rule (Phase F's offline-queue wiring
// pushed it over). No React, no supabase; safe to unit-test in isolation
// if that's ever needed.

export type DraftItem = {
  key: string
  medicineId: string
  medicineName: string
  drugType: string
  strength: string
  beforeAfterFood: string
  dosageFrequency: string
  durationDays: string
  quantityDispensed: string
  notes: string
}

export type ExistingItem = {
  medicine_id?: string
  drug_type: string | null
  strength: string | null
  before_after_food?: string | null
  dosage_frequency: string | null
  duration_days: number
  quantity_dispensed?: number | null
  notes: string | null
  medicines: { name: string } | null
}

export type Template = {
  id: string
  name: string
  prescription_template_items: ExistingItem[]
}

export function newDraftItem(medicineId: string, medicineName: string): DraftItem {
  return {
    key: crypto.randomUUID(),
    medicineId,
    medicineName,
    drugType: 'Tablet',
    strength: '',
    beforeAfterFood: 'After food',
    dosageFrequency: '1-0-1',
    durationDays: '',
    quantityDispensed: '',
    notes: '',
  }
}

export function draftFromExisting(item: ExistingItem): DraftItem | null {
  if (!item.medicine_id) return null
  return {
    key: crypto.randomUUID(),
    medicineId: item.medicine_id,
    medicineName: item.medicines?.name ?? '',
    drugType: item.drug_type ?? 'Tablet',
    strength: item.strength ?? '',
    beforeAfterFood: item.before_after_food ?? 'After food',
    dosageFrequency: item.dosage_frequency ?? '1-0-1',
    durationDays: String(item.duration_days ?? ''),
    quantityDispensed: item.quantity_dispensed != null ? String(item.quantity_dispensed) : '',
    notes: item.notes ?? '',
  }
}

export function itemRow(item: DraftItem) {
  return {
    medicine_id: item.medicineId,
    drug_type: item.drugType,
    strength: item.strength.trim() || null,
    before_after_food: item.beforeAfterFood,
    dosage_frequency: item.dosageFrequency,
    duration_days: Number(item.durationDays),
    quantity_dispensed: Number(item.quantityDispensed),
    notes: item.notes.trim() || null,
  }
}

export function itemIsValid(item: DraftItem): boolean {
  const days = Number(item.durationDays)
  const quantity = Number(item.quantityDispensed)
  return (
    !!item.drugType &&
    !!item.beforeAfterFood &&
    !!item.dosageFrequency &&
    item.durationDays.trim() !== '' &&
    Number.isInteger(days) &&
    days > 0 &&
    item.quantityDispensed.trim() !== '' &&
    Number.isInteger(quantity) &&
    quantity > 0
  )
}
