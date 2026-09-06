// Paise -> rupees for display only, integer arithmetic throughout (no /100
// float division) -- money itself never leaves bigint paise.
export function formatPaise(paise: number): string {
  const rupees = Math.floor(paise / 100)
  const cents = paise % 100
  return `₹${rupees}.${String(cents).padStart(2, '0')}`
}

// Same value, formatted for an editable rupees field: no trailing ".00" for
// a whole-rupee amount, so an untouched field doesn't read as "changed".
export function formatPaiseForInput(paise: number): string {
  const rupees = Math.floor(paise / 100)
  const cents = paise % 100
  return cents === 0 ? String(rupees) : `${rupees}.${String(cents).padStart(2, '0')}`
}

// Parses what a user typed -- rupees, optionally with up to 2 decimal
// places (a real price can be fractional, e.g. 7.50) -- into integer paise
// via string splitting, never parseFloat/Number division: a price like
// 7.50 has no exact binary float representation, and this is the one
// arithmetic path money-adjacent user input drives directly. Returns null
// for anything that isn't a plain non-negative rupees[.paise] number.
export function parseRupeesToPaise(input: string): number | null {
  const trimmed = input.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [rupees, paise = ''] = trimmed.split('.')
  return Number(rupees) * 100 + Number((paise + '00').slice(0, 2))
}
