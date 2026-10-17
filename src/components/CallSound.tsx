import { useEffect, useRef, useState } from 'react'
import { consumeCall, freshCall, playCall, type CallEvent } from '../lib/callSound'

export function useCallSound({ event, userId, clinicId, locked, available }: { event: CallEvent | null | undefined; userId: string; clinicId: string; locked: boolean; available: boolean }) {
  const context = useRef<AudioContext | null>(null)
  const enabledAt = useRef(Infinity)
  const [enabled, setEnabled] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => () => { void context.current?.close() }, [])
  useEffect(() => {
    let alive = true
    if (enabled && !locked && freshCall(event, enabledAt.current, Date.now())) {
      void consumeCall(`call-sound:${clinicId}:${userId}`, event!.id).then(fresh => {
        if (fresh && alive && context.current?.state === 'running') playCall(context.current)
      }).catch(() => { if (alive) setError('Call sound unavailable; watch the live queue.') })
    }
    return () => { alive = false }
  }, [event, enabled, locked, clinicId, userId])
  async function toggle() {
    setError('')
    if (enabled) { enabledAt.current = Infinity; setEnabled(false); return }
    try {
      context.current ??= new AudioContext()
      await context.current.resume()
      if (context.current.state !== 'running') throw new Error()
      enabledAt.current = Date.now(); setEnabled(true); playCall(context.current)
    } catch { setError('Sound could not start. Try again or watch the live queue.') }
  }
  return available ? <><button className="shell-nav-item" type="button" aria-pressed={enabled} onClick={() => void toggle()} title="Enable once per session; only new doctor calls sound">{enabled ? 'Mute notification sound' : 'Enable notification sound'}</button>{error && <span className="form-error" role="alert">{error}</span>}</> : null
}
