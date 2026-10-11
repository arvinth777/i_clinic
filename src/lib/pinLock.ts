// Local idle-lock PIN (docs/architecture-spec.md's "Auth: session and
// idle-lock policy"). Distinct from the account password and verified fully
// offline (Web Crypto needs no network), since an idle-lock that requires
// connectivity to unlock is worse than no lock at all.
//
// Stored in localStorage: a small per-device security artifact, not patient
// data. ponytail: this is a screen lock, not authentication -- anyone with
// devtools can clear localStorage. The recovery path is signing out and in
// again with the real password; a server-verified PIN is the upgrade if the
// threat model ever includes someone with the browser console open.
//
// The locked flag is persisted too, so a reload or a new tab cannot bypass
// the lock, and wrong attempts are throttled (5 free, then 30s doubling up
// to 15 min) so a short PIN cannot be guessed at machine speed.

const PIN_KEY = 'pin_hash'
const LOCK_KEY = 'screen_locked'
const FAIL_KEY = 'pin_fails'
const ITERATIONS = 150_000
const FREE_ATTEMPTS = 5

export const MAX_ATTEMPTS = 10 // after this many wrong PINs the caller signs the user out

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('')

async function derive(pin: string, salt: BufferSource): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256))
}

async function legacySha256(pin: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin)))
}

export function hasPin(): boolean {
  return !!localStorage.getItem(PIN_KEY)
}

export async function setPin(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  localStorage.setItem(PIN_KEY, `v2:${hex(salt)}:${await derive(pin, salt)}`)
  localStorage.removeItem(FAIL_KEY)
}

export function isScreenLocked(): boolean {
  return localStorage.getItem(LOCK_KEY) === '1'
}

export function setScreenLocked(locked: boolean): void {
  if (locked) localStorage.setItem(LOCK_KEY, '1')
  else localStorage.removeItem(LOCK_KEY)
}

export type PinResult = { ok: true } | { ok: false; waitMs: number; attempts: number }

function waitLeft(): { until: number; n: number } {
  try {
    const { n = 0, until = 0 } = JSON.parse(localStorage.getItem(FAIL_KEY) ?? '{}')
    return { n, until }
  } catch {
    return { n: 0, until: 0 }
  }
}

export async function verifyPin(pin: string): Promise<PinResult> {
  const { n, until } = waitLeft()
  if (until > Date.now()) return { ok: false, waitMs: until - Date.now(), attempts: n }
  const stored = localStorage.getItem(PIN_KEY)
  let ok = false
  if (stored?.startsWith('v2:')) {
    const [, salt, hash] = stored.split(':')
    ok = (await derive(pin, Uint8Array.from(salt.match(/../g)!.map((h) => parseInt(h, 16)))) === hash)
  } else if (stored) {
    ok = (await legacySha256(pin)) === stored
    if (ok) await setPin(pin) // upgrade the old unsalted hash in place
  }
  if (ok) {
    localStorage.removeItem(FAIL_KEY)
    return { ok: true }
  }
  const attempts = n + 1
  const waitMs = attempts > FREE_ATTEMPTS ? Math.min(30_000 * 2 ** (attempts - FREE_ATTEMPTS - 1), 15 * 60_000) : 0
  localStorage.setItem(FAIL_KEY, JSON.stringify({ n: attempts, until: Date.now() + waitMs }))
  return { ok: false, waitMs, attempts }
}
