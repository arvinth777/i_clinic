import { update } from 'idb-keyval'

export type CallEvent = { id: string; action: string; created_at: string }
export function freshCall(event: CallEvent | null | undefined, enabledAt: number, now: number) {
  const time = Date.parse(event?.created_at ?? '')
  return event?.action === 'call' && time > enabledAt && time <= now && now - time < 60_000
}

export async function consumeCall(key: string, id: string) {
  let fresh = false
  await update<string[]>(key, old => {
    const seen = Array.isArray(old) ? old : []
    fresh = !seen.includes(id)
    return fresh ? [...seen.slice(-99), id] : seen
  })
  return fresh
}

export async function showCallNotification(tokenNumber: number, eventId: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
  const title = 'Doctor called next patient'
  const options: NotificationOptions = { body: `Token #${tokenNumber} · Please send in`, tag: `clinic-call-${eventId}`, silent: true }
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null
  if (registration) await registration.showNotification(title, options)
  else new Notification(title, options)
  return true
}

export function playCall(context: AudioContext) {
  for (const [frequency, offset] of [[660, 0], [880, .18]]) {
    const oscillator = context.createOscillator(), gain = context.createGain()
    oscillator.type = 'sine'; oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0, context.currentTime + offset)
    gain.gain.linearRampToValueAtTime(.08, context.currentTime + offset + .02)
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + offset + .3)
    oscillator.connect(gain); gain.connect(context.destination)
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
    oscillator.start(context.currentTime + offset); oscillator.stop(context.currentTime + offset + .31)
  }
}
