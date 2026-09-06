export function startOfToday(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export function elapsedMinutes(arrivedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(arrivedAt).getTime()) / 60000))
}

export function formatElapsed(arrivedAt: string): string {
  const mins = elapsedMinutes(arrivedAt)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

// Shared short-date formatting -- was duplicated identically in
// Billing.tsx and MergePatients.tsx before UnpaidBills.tsx made it a
// third copy.
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
