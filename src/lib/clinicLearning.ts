import type { DraftItem } from './prescriptionDraft'

// The clinic's own prescribing history, turned into suggestions. Nothing leaves the browser and it works offline:
// everything below is counting what this clinic already did, newest first.
export type HistoryItem = {
  medicine_id: string | null
  drug_type: string | null
  strength: string | null
  before_after_food: string | null
  dosage_frequency: string | null
  duration_days: number | null
  prescription_id: string
  medicines?: { name: string; molecule_name: string | null } | null
  prescriptions?: { diagnosis: string | null; advice: string | null } | null
}
export type Defaults = { drugType?: string; strength?: string; beforeAfterFood?: string; dosageFrequency?: string; durationDays?: string }
type Counted = { text: string; count: number }
export type Learning = {
  defaults: Map<string, Defaults>
  popularity: Map<string, number>
  diagnoses: Counted[]
  byDiagnosis: Map<string, { id: string; name: string; count: number }[]>
  advice: Counted[]
  names: Map<string, string>
}
export const EMPTY_LEARNING: Learning = { defaults: new Map(), popularity: new Map(), diagnoses: [], byDiagnosis: new Map(), advice: [], names: new Map() }

export const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()

// Most common value; on a tie the most recent one (items arrive newest first, so the first seen wins).
function mode(values: (string | number | null | undefined)[]): string | undefined {
  const counts = new Map<string, number>()
  for (const value of values) { const key = value == null ? '' : String(value).trim(); if (key) counts.set(key, (counts.get(key) ?? 0) + 1) }
  let best: string | undefined, bestCount = 0
  for (const [key, count] of counts) if (count > bestCount) { best = key; bestCount = count }
  return best
}

function ranked(counts: Map<string, { text: string; count: number }>): Counted[] {
  return [...counts.values()].sort((a, b) => b.count - a.count)
}

export function learn(items: HistoryItem[]): Learning {
  const byMedicine = new Map<string, HistoryItem[]>()
  const prescriptions = new Map<string, { diagnosis: string | null; advice: string | null; medicines: Map<string, string> }>()
  for (const item of items) {
    if (item.medicine_id) {
      byMedicine.set(item.medicine_id, [...(byMedicine.get(item.medicine_id) ?? []), item])
      const entry = prescriptions.get(item.prescription_id) ?? { diagnosis: item.prescriptions?.diagnosis ?? null, advice: item.prescriptions?.advice ?? null, medicines: new Map() }
      entry.medicines.set(item.medicine_id, item.medicines?.molecule_name || item.medicines?.name || '')
      prescriptions.set(item.prescription_id, entry)
    }
  }
  const defaults = new Map<string, Defaults>(), popularity = new Map<string, number>(), names = new Map<string, string>()
  for (const [id, rows] of byMedicine) {
    popularity.set(id, new Set(rows.map(r => r.prescription_id)).size)
    names.set(id, rows[0].medicines?.molecule_name || rows[0].medicines?.name || '')
    defaults.set(id, {
      drugType: mode(rows.map(r => r.drug_type)), strength: mode(rows.map(r => r.strength)), beforeAfterFood: mode(rows.map(r => r.before_after_food)),
      dosageFrequency: mode(rows.map(r => r.dosage_frequency)), durationDays: mode(rows.map(r => r.duration_days)),
    })
  }
  const diagnosisCounts = new Map<string, Counted>(), adviceCounts = new Map<string, Counted>()
  const medicinesByDiagnosis = new Map<string, Map<string, { id: string; name: string; count: number }>>()
  for (const entry of prescriptions.values()) {
    const diagnosis = entry.diagnosis?.trim()
    if (diagnosis) {
      const key = normalize(diagnosis)
      const seen = diagnosisCounts.get(key)
      diagnosisCounts.set(key, { text: seen?.text ?? diagnosis, count: (seen?.count ?? 0) + 1 })
      const meds = medicinesByDiagnosis.get(key) ?? new Map()
      for (const [id, name] of entry.medicines) meds.set(id, { id, name, count: (meds.get(id)?.count ?? 0) + 1 })
      medicinesByDiagnosis.set(key, meds)
    }
    for (const line of (entry.advice ?? '').split('\n').map(l => l.trim()).filter(l => l.length >= 6 && l.length <= 200)) {
      const key = normalize(line); const seen = adviceCounts.get(key)
      adviceCounts.set(key, { text: seen?.text ?? line, count: (seen?.count ?? 0) + 1 })
    }
  }
  const byDiagnosis = new Map<string, { id: string; name: string; count: number }[]>()
  for (const [key, meds] of medicinesByDiagnosis) byDiagnosis.set(key, [...meds.values()].sort((a, b) => b.count - a.count))
  return { defaults, popularity, diagnoses: ranked(diagnosisCounts), byDiagnosis, advice: ranked(adviceCounts), names }
}

// Past diagnoses that start with, or contain, what is being typed; the most used first. An exact match is not offered again.
export function matchingDiagnoses(learning: Learning, typed: string, limit = 5): string[] {
  const q = normalize(typed)
  return learning.diagnoses
    .filter(d => { const key = normalize(d.text); return key !== q && (!q || key.includes(q)) })
    .sort((a, b) => Number(normalize(b.text).startsWith(q)) - Number(normalize(a.text).startsWith(q)) || b.count - a.count)
    .slice(0, limit).map(d => d.text)
}

// What this clinic usually prescribes for the diagnosis written (exact match, ignoring case and spacing), most common first.
export function medicinesForDiagnosis(learning: Learning, diagnosis: string, limit = 4) {
  return (learning.byDiagnosis.get(normalize(diagnosis)) ?? []).filter(m => m.name).slice(0, limit)
}

// Fill dose, duration, food and strength with what this medicine is usually prescribed as. Nothing is invented: a field with no history stays as it was.
export function applyDefaults(item: DraftItem, defaults: Defaults | undefined): DraftItem {
  if (!defaults) return item
  return {
    ...item,
    drugType: defaults.drugType ?? item.drugType,
    strength: item.strength || defaults.strength || '',
    beforeAfterFood: defaults.beforeAfterFood ?? item.beforeAfterFood,
    dosageFrequency: item.dosageFrequency || defaults.dosageFrequency || '',
    durationDays: item.durationDays || defaults.durationDays || '',
  }
}

export const sortByPopularity = <T extends { id: string }>(rows: T[], learning: Learning): T[] =>
  [...rows].sort((a, b) => (learning.popularity.get(b.id) ?? 0) - (learning.popularity.get(a.id) ?? 0))

// The medicines this clinic prescribes most, minus the ones already on the prescription.
export const topMedicines = (learning: Learning, exclude: Set<string>, limit = 6) =>
  [...learning.popularity].filter(([id]) => !exclude.has(id) && learning.names.get(id)).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => ({ id, name: learning.names.get(id)! }))

// Advice lines this clinic often writes that are not already in the advice box.
export const adviceSuggestions = (learning: Learning, current: string, limit = 4) =>
  learning.advice.filter(a => !normalize(current).includes(normalize(a.text))).slice(0, limit).map(a => a.text)

// The values typed most often (case and spacing ignored), most used first; for the front desk's complaint and address boxes.
export function topValues(values: (string | null | undefined)[], limit = 40): string[] {
  const counts = new Map<string, { text: string; count: number }>()
  for (const value of values) {
    const text = value?.trim().replace(/\s+/g, ' ')
    if (!text || text.length < 3) continue
    const key = text.toLowerCase(), seen = counts.get(key)
    counts.set(key, { text: seen?.text ?? text, count: (seen?.count ?? 0) + 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit).map(v => v.text)
}
