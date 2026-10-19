// Outline icons on a 24-unit grid, one 1.5 stroke, round caps and joins, no fills: a single weight and colour reads as quiet and
// consistent (the way Linear, Carbon and Stripe draw theirs). Decorative: the button or label next to an icon says what it does.
type Glyph = { line: string }

const GLYPHS = {
  check: { line: 'M5 12.5l4.5 4.5L19 7.5' },
  plus: { line: 'M12 5v14M5 12h14' },
  close: { line: 'M6.5 6.5l11 11M17.5 6.5l-11 11' },
  arrow: { line: 'M5 12h14M13.5 6.5L19 12l-5.5 5.5' },
  search: { line: 'M10.8 18.1a7.3 7.3 0 1 0 0-14.6 7.3 7.3 0 0 0 0 14.6zM20.5 20.5l-4.6-4.6' },
  rupee: { line: 'M7 5.5h10M7 9.5h10M7 5.5c4.6 0 7 1.4 7 4s-2.4 4-7 4l6.5 5.5' },
  print: { line: 'M7 9V4h10v5M7 17.5H5.5a1.5 1.5 0 0 1-1.5-1.5v-5a1.5 1.5 0 0 1 1.5-1.5h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17M7 14h10v6.5H7z' },
  pill: { line: 'M10.5 20.2a4.9 4.9 0 0 1-6.9-6.9l9.7-9.7a4.9 4.9 0 0 1 6.9 6.9zM8.4 8.6l7 7' },
  alert: { line: 'M12 8.5v4.5M12 16.4v.1M10.4 4.2L2.9 17.3A1.8 1.8 0 0 0 4.5 20h15a1.8 1.8 0 0 0 1.6-2.7L13.6 4.2a1.8 1.8 0 0 0-3.2 0z' },
  // consultation: a heart with a pulse line through it
  pulse: { line: 'M12 20.3S3.4 15.4 3.4 9.1A4.6 4.6 0 0 1 12 6.7a4.6 4.6 0 0 1 8.6 2.4c0 6.3-8.6 11.2-8.6 11.2zM7.6 12.4h2.3l1.3-2.6 1.9 4.6 1.3-2h2' },
  // patients: a head and shoulders
  user: { line: 'M12 11.6a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6zM4.4 20.2c.5-3.9 3.5-6 7.6-6s7.1 2.1 7.6 6' },
  // billing: a receipt with a rupee mark
  receipt: { line: 'M6.2 3.6h11.6v16.8l-2.4-1.5-2.7 1.5-2.7-1.5-2.4 1.5-1.4-.9zM9.4 8.2h5.2M9.4 11h5.2M9.4 8.2c2.3 0 3.1.8 3.1 1.9s-.9 1.9-3.1 1.9l3.5 3' },
  // stock: a shipping box
  box: { line: 'M12 3.2l8 4.2v9.2l-8 4.2-8-4.2V7.4zM4 7.4l8 4.2 8-4.2M12 11.6v9.2' },
  // reports: three bars on a base line
  chart: { line: 'M5 13.4a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM10.1 5a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-1.8a1 1 0 0 1-1-1zM15.2 9.4a1 1 0 0 1 1-1H18a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1h-1.8a1 1 0 0 1-1-1z' },
  clock: { line: 'M12 20.6a8.6 8.6 0 1 0 0-17.2 8.6 8.6 0 0 0 0 17.2zM12 7.6V12l3.1 1.9' },
  calendar: { line: 'M7.5 3.2v3M16.5 3.2v3M4 9.4h16M5.6 4.8h12.8a1.6 1.6 0 0 1 1.6 1.6v12a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.4v-12a1.6 1.6 0 0 1 1.6-1.6zM9 14.6l2 2 4-4' },
} as const satisfies Record<string, Glyph>

export type IconName = keyof typeof GLYPHS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const glyph: Glyph = GLYPHS[name]
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={glyph.line} />
    </svg>
  )
}
