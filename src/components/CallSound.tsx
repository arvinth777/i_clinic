import { useEffect, useRef, useState } from 'react'
import { consumeCall, freshCall, playCall, showCallNotification, type CallEvent } from '../lib/callSound'

export function useCallSound({ event, tokenNumber, userId, clinicId, locked, available }: { event: CallEvent | null | undefined; tokenNumber?: number; userId: string; clinicId: string; locked: boolean; available: boolean }) {
  const context = useRef<AudioContext | null>(null)
  const mountedAt = useRef(0)
  const soundEnabled = useRef(false)
  const [enabled, setEnabled] = useState(false)
  const [flash, setFlash] = useState<{ id: string; tokenNumber?: number } | null>(null)
  const [permission, setPermission] = useState(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  const [error, setError] = useState('')
  useEffect(() => { mountedAt.current = Date.now() }, [])
  useEffect(() => () => { void context.current?.close() }, [])
  useEffect(() => {
    let alive = true
    if (available && !locked && freshCall(event, mountedAt.current, Date.now())) {
      void consumeCall(`call-alert:${clinicId}:${userId}`, event!.id).then(fresh => {
        if (!fresh || !alive) return
        setFlash({ id: event!.id, tokenNumber })
        if (soundEnabled.current && context.current?.state === 'running') playCall(context.current)
        if (tokenNumber != null) void showCallNotification(tokenNumber, event!.id).catch(() => setError('Browser notification unavailable; the call remains visible here.'))
      }).catch(() => { if (alive) setError('Call alert unavailable; watch the live queue.') })
    }
    return () => { alive = false }
  }, [event, tokenNumber, available, locked, clinicId, userId])
  useEffect(() => { if (!flash) return; const timer = setTimeout(() => setFlash(null), 1800); return () => clearTimeout(timer) }, [flash])
  async function toggle() {
    setError('')
    if (enabled) { soundEnabled.current = false; setEnabled(false); return }
    try {
      context.current ??= new AudioContext()
      await context.current.resume()
      if (context.current.state !== 'running') throw new Error()
      soundEnabled.current = true; setEnabled(true); playCall(context.current)
    } catch { setError('Sound could not start. Try again or watch the live queue.') }
  }
  async function enableNotifications() {
    setError('')
    if (typeof Notification === 'undefined' || !window.isSecureContext) { setError('Browser notifications need HTTPS and a supported browser.'); return }
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      if (result !== 'granted') setError('Browser notifications were not allowed. Calls still appear in the clinic app.')
    } catch { setError('Browser notifications could not start. Calls still appear in the clinic app.') }
  }
  const controls = available ? <div className="call-alert-controls">
    <button className="shell-nav-item" type="button" aria-pressed={enabled} onClick={() => void toggle()} title="Enable once per session; only new doctor calls sound">{enabled ? 'Mute call chime' : 'Enable call chime'}</button>
    {permission === 'default' && <button className="shell-nav-item" type="button" onClick={() => void enableNotifications()}>Enable browser notifications</button>}
    {permission === 'granted' && <span className="field-hint">Browser notifications on</span>}
    {permission === 'denied' && <span className="field-hint">Browser notifications blocked in site settings</span>}
    {permission === 'unsupported' && <span className="field-hint">Browser notifications unavailable here</span>}
    {error && <span className="form-error" role="alert">{error}</span>}
  </div> : null
  return { controls, flash, enabled, permission }
}
