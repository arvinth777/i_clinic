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

// The other direction of formatDateOnly's fix: building a plain
// YYYY-MM-DD from a Date, for a date-only RPC param (get_gst_report's
// p_start_date/p_end_date) -- not for a timestamptz comparison, which
// wants a real instant instead (see startOfToday above). d.toISOString()
// converts to UTC first, which rolls the calendar date back a day for
// part of the day in any timezone ahead of UTC (IST is UTC+5:30, so
// midnight-5:30am IST would report yesterday's date).
export function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
