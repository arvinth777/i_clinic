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
  if (minutes >= 600) return null
  const display = `${minutes} min`

  return (
    <span className="consultation-clock">
       · {display} in consult
    </span>
  )
}
