export type PillTone = 'info' | 'live' | 'warn' | 'ok' | 'bad' | 'mute'

// A small coloured label with a dot: the colour carries the state, the words say it (never colour alone).
export function StatusPill({ tone, children }: { tone: PillTone; children: React.ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>
}
