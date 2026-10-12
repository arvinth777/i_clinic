import { useEffect, useRef } from 'react'

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'] as const

// Per-station idle-lock timeout (docs/architecture-spec.md): fires onIdle
// after timeoutMs with no activity, resetting on any of the events above.
// Armed even without a PIN: LockScreen then asks to sign in again.
export function useIdleTimer(timeoutMs: number, onIdle: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onIdleRef = useRef(onIdle)
  onIdleRef.current = onIdle

  useEffect(() => {
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
  }, [timeoutMs])
}
