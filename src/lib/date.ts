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
