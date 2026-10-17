// Paise -> rupees for display only, integer arithmetic throughout (no /100
// float division) -- money itself never leaves bigint paise. Every
// individual bill amount is non-negative by its own check constraint, but
// an aggregate (Reports' discount total) sums many rows and, against
// dirty-enough data, can land negative -- handled here rather than
// assumed away, since Math.floor/% on a negative dividend in JS produce
// a negative "rupees" and negative "cents" independently (e.g. -712 and
// -25), reading as "₹-712.-25" instead of "-₹712.25".
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / 100)
  const cents = abs % 100
  return `${sign}₹${rupees}.${String(cents).padStart(2, '0')}`
}

// Plain "290.00" with no currency sign: receipts head their money columns "Rs." because dot-matrix printers often have no rupee glyph.
export function formatRupees(paise: number): string {
  return `${paise < 0 ? '-' : ''}${Math.floor(Math.abs(paise) / 100)}.${String(Math.abs(paise) % 100).padStart(2, '0')}`
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

// "Rupees Two Hundred Ninety Only", the way an Indian receipt writes an amount: crore/lakh/thousand grouping, integer paise only.
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function below1000(n: number): string {
  const hundreds = Math.floor(n / 100), rest = n % 100
  return [hundreds ? `${ONES[hundreds]} Hundred` : '', rest < 20 ? ONES[rest] : `${TENS[Math.floor(rest / 10)]}${rest % 10 ? ` ${ONES[rest % 10]}` : ''}`].filter(Boolean).join(' ')
}
function inWords(n: number): string {
  if (n === 0) return 'Zero'
  const crore = Math.floor(n / 1e7), lakh = Math.floor((n % 1e7) / 1e5), thousand = Math.floor((n % 1e5) / 1e3), rest = n % 1e3
  return [crore ? `${inWords(crore)} Crore` : '', lakh ? `${below1000(lakh)} Lakh` : '', thousand ? `${below1000(thousand)} Thousand` : '', rest ? below1000(rest) : ''].filter(Boolean).join(' ')
}
export function amountInWords(paise: number): string {
  const abs = Math.abs(Math.trunc(paise)), rupees = Math.floor(abs / 100), cents = abs % 100
  return `Rupees ${inWords(rupees)}${cents ? ` and ${inWords(cents)} Paise` : ''} Only`
}
