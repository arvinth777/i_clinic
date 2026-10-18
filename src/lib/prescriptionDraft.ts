// Pure draft-item shaping for PrescriptionForm.tsx -- extracted so that
// file stays under the 500-line rule (Phase F's offline-queue wiring
// pushed it over). No React, no supabase; safe to unit-test in isolation
// if that's ever needed.

export type DraftItem = {
  key: string
  medicineId: string
  medicineName: string
  drugType: string
  stockUnit: string
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
  stock_unit?: string | null
  molecule_name?: string | null
  notes: string | null
  medicines: { name: string } | null
}

export type Template = {
  id: string
  name: string
  prescription_template_items: ExistingItem[]
}

export type PastPrescription = {
  id: string
  visit_id?: string
  created_at: string
  prescription_items: ExistingItem[]
}

export type ComboItem = { medicineId: string; medicineName: string; item: ExistingItem }

// "Usual combo" -- majority of the patient's last 5 prescriptions, not
// simply the most recent one (Phase UI-3, replacing plain "repeat last"):
// a one-off addition -- an antibiotic for a passing infection, say --
// shouldn't get suggested forever the way repeating just the last visit
// would. Needs at least 2 past prescriptions to call anything "usual" at
// all; one data point isn't a pattern. Each qualifying medicine's fields
// come from its own most recent occurrence, never blended across visits.
// `pastPrescriptions` is expected newest-first (Consultation.tsx's own
// query already orders it that way).
export function usualCombo(pastPrescriptions: PastPrescription[]): ComboItem[] {
  const recent = pastPrescriptions.slice(0, 5)
  if (recent.length < 2) return []

  const seen = new Map<string, { count: number; item: ExistingItem; medicineName: string }>()
  for (const prescription of recent) {
    const countedThisPrescription = new Set<string>()
    for (const item of prescription.prescription_items) {
      if (!item.medicine_id || countedThisPrescription.has(item.medicine_id)) continue
      countedThisPrescription.add(item.medicine_id)
      const existing = seen.get(item.medicine_id)
      if (existing) {
        existing.count += 1
      } else {
        seen.set(item.medicine_id, { count: 1, item, medicineName: item.molecule_name || item.medicines?.name || '' })
      }
    }
  }

  const majority = recent.length / 2
  return [...seen.entries()]
    .filter(([, v]) => v.count > majority)
    .map(([medicineId, v]) => ({ medicineId, medicineName: v.medicineName, item: v.item }))
}

// Drug type follows the confirmed stock unit; anything else is chosen by the
// doctor. The dose is never prefilled: a default like 1-0-1 gets signed off
// unread.
const TYPE_BY_UNIT: Record<string, string> = { tablet: 'Tablet', strip: 'Tablet', capsule: 'Capsule', syrup: 'Syrup', bottle: 'Syrup', powder: 'Powder', sachet: 'Powder', injection: 'Injection', vial: 'Injection', tube: 'Topical' }
const UNIT_BY_TYPE: Record<string, string> = { Tablet: 'tablet', Capsule: 'capsule', Syrup: 'bottle', Powder: 'sachet', Injection: 'vial', Topical: 'tube', Other: 'unit' }
export const prescribedUnit = (drugType: string): string => UNIT_BY_TYPE[drugType] ?? 'unit'

export function newDraftItem(medicineId: string, medicineName: string, stockUnit?: string | null): DraftItem {
  return {
    key: crypto.randomUUID(),
    medicineId,
    medicineName,
    drugType: stockUnit ? TYPE_BY_UNIT[stockUnit.trim().toLowerCase().replace(/s$/, '')] ?? 'Other' : 'Tablet',
    stockUnit: stockUnit?.trim().toLowerCase() ?? '',
    strength: '',
    beforeAfterFood: 'After food',
    dosageFrequency: '',
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
    medicineName: item.molecule_name || item.medicines?.name || '',
    drugType: item.drug_type ?? 'Tablet',
    stockUnit: item.stock_unit ?? '',
    strength: item.strength ?? '',
    beforeAfterFood: item.before_after_food ?? 'After food',
    dosageFrequency: item.dosage_frequency ?? '',
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

export type MissingField = { field: 'type' | 'unit' | 'strength' | 'food' | 'frequency' | 'duration' | 'quantity'; label: string }

// What still has to be filled in on a drug row, in the order the row shows them.
export function itemMissing(item: DraftItem): MissingField[] {
  const wholePositive = (text: string) => text.trim() !== '' && Number.isInteger(Number(text)) && Number(text) > 0
  const unit = item.stockUnit.trim()
  const missing: MissingField[] = []
  if (!item.drugType) missing.push({ field: 'type', label: 'type' })
  if (item.strength.trim() === '') missing.push({ field: 'strength', label: 'strength' })
  if (item.drugType === 'Other' && (unit.length === 0 || unit.length > 24)) missing.push({ field: 'unit', label: 'supply unit' })
  if (!item.beforeAfterFood) missing.push({ field: 'food', label: 'before/after food' })
  if (!item.dosageFrequency) missing.push({ field: 'frequency', label: 'how often' })
  if (!wholePositive(item.durationDays)) missing.push({ field: 'duration', label: 'number of days' })
  if (!wholePositive(item.quantityDispensed)) missing.push({ field: 'quantity', label: 'quantity' })
  return missing
}

export function itemIsValid(item: DraftItem): boolean {
  return itemMissing(item).length === 0
}

// Only a whole quantity in the same stock unit can be suggested safely.
export function suggestedQuantity(item: DraftItem, stockUnit: string | null | undefined): number | null {
  if (!/^(tablets?|capsules?)$/i.test(stockUnit ?? '') || !/^(Tablet|Capsule)$/.test(item.drugType)) return null
  if (!/^\d+(?:\.\d+)?-\d+(?:\.\d+)?-\d+(?:\.\d+)?$/.test(item.dosageFrequency)) return null
  const days = Number(item.durationDays)
  if (!Number.isSafeInteger(days) || days <= 0) return null
  const quantity = item.dosageFrequency.split('-').reduce((sum, dose) => sum + Number(dose), 0) * days
  return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : null
}
