import { Stethoscope, Users, ReceiptIndianRupee, Package, ChartColumn, Clock, CalendarCheck, Search, ArrowRight, Check, Plus, X, IndianRupee, Printer, Pill, TriangleAlert, type LucideIcon } from 'lucide-react'

// One icon set for the whole app (Lucide: thin 1.5 line, rounded, single colour), so the sidebar, buttons and empty states match.
// Only the icons listed here are bundled. Decorative: the button or label next to an icon says what it does.
const ICONS = {
  check: Check,
  plus: Plus,
  close: X,
  arrow: ArrowRight,
  search: Search,
  rupee: IndianRupee,
  print: Printer,
  pill: Pill,
  alert: TriangleAlert,
  pulse: Stethoscope, // consultation
  user: Users, // patients
  receipt: ReceiptIndianRupee, // billing
  box: Package, // stock
  chart: ChartColumn, // reports
  clock: Clock, // queue
  calendar: CalendarCheck,
} as const satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const Glyph = ICONS[name]
  return <Glyph className="icon" size={size} strokeWidth={1.5} aria-hidden="true" />
}
