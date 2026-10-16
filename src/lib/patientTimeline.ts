// One time-ordered list of what happened to a patient, built from rows the doctor can already read.
// Every event carries the real timestamp of that event; an examination date is date-only and is never given a time.
export type TimelineKind = 'visit' | 'prescription' | 'payment' | 'upload'
export type TimelineEvent = { key: string; kind: TimelineKind; at: string; title: string; detail?: string; amountPaise?: number; visitId?: string; examinationDate?: string }

type Settlement = { payment_method: string; settled_at: string }
export type TimelineBill = { id: string; visit_id: string; final_amount_paise: number; payment_method: string; confirmed_at: string; corrects_bill_id: string | null; bill_settlements: Settlement | Settlement[] | null }
type TimelineInput = {
  visits: { id: string; arrived_at: string; complaint: string; token_number: number }[]
  prescriptions: { id: string; visit_id: string; created_at: string; diagnosis: string | null }[]
  bills: TimelineBill[]
  files: { id: string; title: string; category: string; examination_date: string | null; created_at: string; status: string }[]
}

const method = (m: string) => (m === 'upi' ? 'UPI' : m === 'cash' ? 'cash' : m.replaceAll('_', ' '))

export function buildTimeline({ visits, prescriptions, bills, files }: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const v of visits) events.push({ key: `visit:${v.id}`, kind: 'visit', at: v.arrived_at, title: `Visit · token #${v.token_number}`, detail: v.complaint || undefined, visitId: v.id })
  for (const p of prescriptions) events.push({ key: `rx:${p.id}`, kind: 'prescription', at: p.created_at, title: 'Prescription issued', detail: p.diagnosis || undefined, visitId: p.visit_id })
  for (const b of bills) {
    const base = { kind: 'payment' as const, amountPaise: b.final_amount_paise, visitId: b.visit_id }
    if (b.corrects_bill_id) events.push({ ...base, key: `bill:${b.id}`, at: b.confirmed_at, title: `Bill correction · ${method(b.payment_method)}` })
    else if (b.payment_method === 'pay_later') events.push({ ...base, key: `bill:${b.id}`, at: b.confirmed_at, title: 'Bill confirmed · pay later, not paid yet' })
    else events.push({ ...base, key: `bill:${b.id}`, at: b.confirmed_at, title: `Payment received · ${method(b.payment_method)}` })
    const settlement = Array.isArray(b.bill_settlements) ? b.bill_settlements[0] : b.bill_settlements
    if (settlement) events.push({ ...base, key: `settle:${b.id}`, at: settlement.settled_at, title: `Pay-later bill settled · ${method(settlement.payment_method)}` })
  }
  for (const f of files) if (f.status === 'ready') events.push({ key: `file:${f.id}`, kind: 'upload', at: f.created_at, title: `Document uploaded · ${f.title}`, detail: f.category, examinationDate: f.examination_date ?? undefined })
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.key.localeCompare(b.key))
}
