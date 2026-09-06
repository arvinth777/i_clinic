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

// For a plain YYYY-MM-DD value (next_review_due, follow_up_date,
// rest_from/rest_to -- date columns, not timestamptz): Date's own
// parsing treats a date-only string as UTC midnight, which a browser in
// a timezone behind UTC would then display as the previous day.
// Constructing from the parts directly avoids that.
export function formatDateOnly(dateOnly: string): string {
  const [y, m, d] = dateOnly.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
