export type AlertTarget = { section: string; visitId?: string; patientId?: string; medicineId?: string; patientTab?: 'visits' | 'documents' }
export type ClinicAlert = AlertTarget & { id: string; title: string; detail: string; severity: 'blue' | 'amber' | 'red'; informational?: boolean }
export type AlertVisit = { id: string; patient_id: string; token_number: number; stage: string; arrived_at: string; called_at: string | null; not_here_at: string | null; discount_requested_at: string | null }
export type AlertMedicine = { id: string; name: string; low_stock_threshold: number | null; expiry_date: string | null }
export type AlertSource = { visits: AlertVisit[]; medicines: AlertMedicine[]; stock: { medicine_id: string; quantity: number }[]; noShowMinutes: number; shortfalls: { bill_id: string; shortfall: number; bills: { visit_id: string; visits: { patient_id: string; token_number: number } } }[] }
export type RecentAlert = ClinicAlert & { read: boolean; dismissed: boolean; firstSeen: string; resolvedAt: string | null }

export function buildClinicAlerts(source: AlertSource, isDoctor: boolean, now: number, today: string): ClinicAlert[] {
  const alerts: ClinicAlert[] = []
  const add = (visit: AlertVisit, kind: string, title: string, detail: string, section: string) => alerts.push({ id: `${kind}:${visit.id}`, title: `#${visit.token_number} · ${title}`, detail, section, visitId: visit.id, patientId: visit.patient_id, severity: 'amber' })
  for (const visit of [...source.visits].sort((a,b) => (a.stage === 'called' ? 0 : a.stage === 'with_doctor' ? 1 : 2) - (b.stage === 'called' ? 0 : b.stage === 'with_doctor' ? 1 : 2) || b.arrived_at.localeCompare(a.arrived_at))) {
    if (visit.stage === 'called') {
      add(visit, 'called', 'Called · waiting for reception', 'Reception needs to mark Sent in.', 'reception')
      if (visit.called_at && now - Date.parse(visit.called_at) >= 5 * 60_000) add(visit, 'sent-reminder', 'Still waiting to be sent in', 'Called at least five minutes ago. Check presence before acting.', 'reception')
    }
    if (isDoctor && visit.stage === 'with_doctor') add(visit, 'sent', 'Reception sent this patient in', 'Open the doctor workspace.', 'consultation')
    if (!isDoctor && visit.stage === 'ready_to_bill') add(visit, 'bill', 'Ready to bill', 'Review supplied quantities and collect payment.', 'billing')
    if (isDoctor && visit.stage === 'ready_to_bill' && visit.discount_requested_at) add(visit, 'discount', 'Discount review requested', 'Reception is waiting for your review.', 'consultation')
    if (!isDoctor && visit.stage === 'not_here' && visit.not_here_at && now - Date.parse(visit.not_here_at) >= source.noShowMinutes * 60_000) add(visit, 'no-show', 'Please review absence', 'The no-show time has passed. Nothing is removed automatically.', 'reception')
  }
  if (!isDoctor) {
    const groups = new Map<string, AlertVisit[]>()
    for (const visit of source.visits.filter(v => v.arrived_at >= today && !['paid', 'no_show'].includes(v.stage))) groups.set(visit.patient_id, [...(groups.get(visit.patient_id) ?? []), visit])
    for (const rows of groups.values()) if (rows.length > 1) add(rows[0], 'duplicate', 'Possible duplicate check-in', `Open tokens: ${rows.map(v => `#${v.token_number}`).join(', ')}. Review before issuing another token.`, 'reception')
  }
  const quantities = new Map<string, number>()
  for (const row of source.stock) quantities.set(row.medicine_id, (quantities.get(row.medicine_id) ?? 0) + row.quantity)
  const todayDate = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  for (const medicine of source.medicines) {
    const total = quantities.get(medicine.id) ?? 0
    const days = medicine.expiry_date ? (Date.parse(`${medicine.expiry_date}T00:00:00Z`) - Date.parse(`${todayDate}T00:00:00Z`)) / 86_400_000 : Infinity
    const details: string[] = []
    if (total < 0) details.push('Negative stock needs reconciliation')
    else if (medicine.low_stock_threshold !== null && total <= medicine.low_stock_threshold) details.push(`Low stock · ${total} units`)
    if (total > 0 && days <= 30) details.push(days < 0 ? 'Expired' : `Expiry within 30 days · ${medicine.expiry_date}`)
    if (details.length) alerts.push({ id: `stock:${medicine.id}`, title: medicine.name, detail: details.join(' · '), severity: total < 0 || days < 0 ? 'red' : 'amber', section: 'stock', medicineId: medicine.id })
  }
  if (isDoctor) {
    const bills = new Map<string, AlertSource['shortfalls']>()
    for (const row of source.shortfalls) bills.set(row.bill_id, [...(bills.get(row.bill_id) ?? []), row])
    for (const [id, rows] of bills) alerts.push({ id: `shortfall:${id}`, title: `#${rows[0].bills.visits.token_number} · Partial medicine supply`, detail: `${rows.reduce((sum, row) => sum + row.shortfall, 0)} prescribed units were not supplied. See visit history.`, severity: 'amber', section: 'patients', patientId: rows[0].bills.visits.patient_id, visitId: rows[0].bills.visit_id, informational: true })
  }
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date(now))
  if (Number(parts) >= 16 && source.visits.length) alerts.push({ id: `closing:${today}`, title: 'End-of-day review', detail: `${source.visits.filter(v => v.stage === 'ready_to_bill').length} unpaid visits · ${source.visits.filter(v => v.stage !== 'ready_to_bill').length} unresolved visits. Check pending saves and uploads too.`, section: 'reception', severity: 'amber' })
  return alerts
}

export function reconcileAlerts(previous: RecentAlert[], active: ClinicAlert[], now: string): RecentAlert[] {
  const byId = new Map(previous.map(alert => [alert.id, alert]))
  const ids = new Set(active.map(alert => alert.id))
  const current = active.map(alert => {
    const old = byId.get(alert.id)
    return { ...alert, firstSeen: old?.firstSeen ?? now, read: old?.resolvedAt ? false : old?.read ?? false, dismissed: old?.resolvedAt ? false : old?.dismissed ?? false, resolvedAt: null }
  })
  return [...current, ...previous.filter(alert => !ids.has(alert.id)).map(alert => ({ ...alert, resolvedAt: alert.resolvedAt ?? now })).slice(0, 500)]
}
