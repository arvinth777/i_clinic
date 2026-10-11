import { useEffect, useRef } from 'react'

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'] as const

// Per-station idle-lock timeout (docs/architecture-spec.md): fires onIdle
// after timeoutMs with no activity, resetting on any of the events above.
// Disabled entirely (no listeners attached) when `enabled` is false -- the
// lock has nothing to arm itself with before a PIN exists (pinLock.ts).
export function useIdleTimer(enabled: boolean, timeoutMs: number, onIdle: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  useEffect(() => {
    if (!enabled) return

    function reset() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => onIdleRef.current(), timeoutMs)
    }

    reset()
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, reset)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, reset)
    }
  }, [enabled, timeoutMs])
}
