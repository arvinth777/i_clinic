// Local idle-lock PIN (docs/architecture-spec.md's "Auth: session and
// idle-lock policy" -- Critical finding: this section was entirely
// unimplemented). Distinct from the account password; verified fully
// offline (Web Crypto's SHA-256 needs no network round trip), since an
// idle-lock that requires connectivity to unlock is worse than no lock at
// all -- the concern is protecting a screen during exactly the kind of
// outage this app defends against elsewhere. Stored in localStorage, not
// IndexedDB or the offline mutation queue's own store: this is a small,
// synchronous-enough, per-device security artifact, not patient data or a
// queued write. Clearing local browser storage wipes it -- correct
// behaviour per the architecture decision; the recovery path is signing
// in again with the real password to set a fresh PIN on that device.

const STORAGE_KEY = 'pin_hash'

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function hasPin(): boolean {
  return !!localStorage.getItem(STORAGE_KEY)
}

export async function setPin(pin: string): Promise<void> {
  localStorage.setItem(STORAGE_KEY, await sha256Hex(pin))
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return false
  return (await sha256Hex(pin)) === stored
}
