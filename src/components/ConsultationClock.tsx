import { useEffect, useState } from 'react'

// Ticks every second, purely for data reference later (Phase UI-4) --
// distinct from wait time (arrived_at): this is how long the doctor has
// actually been with this patient, not how long they waited beforehand.
// Recomputed from Date.now() on every tick rather than incrementing a
// counter, so it can't drift.
export function ConsultationClock({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return (
    <span className="consultation-clock">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 14" />
      </svg>
      {display} in consult
    </span>
  )
}
