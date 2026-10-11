import { update } from 'idb-keyval'

export type CallEvent = { id: string; action: string; created_at: string }
export function freshCall(event: CallEvent | null | undefined, enabledAt: number, now: number) {
  const time = Date.parse(event?.created_at ?? '')
  return event?.action === 'call' && time > enabledAt && time <= now && now - time < 10_000
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

export function playCall(context: AudioContext) {
  const oscillator = context.createOscillator(), gain = context.createGain()
  oscillator.type = 'sine'; oscillator.frequency.value = 660
  gain.gain.setValueAtTime(0, context.currentTime)
  gain.gain.linearRampToValueAtTime(.08, context.currentTime + .02)
  gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .35)
  oscillator.connect(gain); gain.connect(context.destination)
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
  oscillator.start(); oscillator.stop(context.currentTime + .36)
}
