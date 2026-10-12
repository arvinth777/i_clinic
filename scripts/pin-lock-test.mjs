// PIN lock logic (src/lib/pinLock.ts): salted hash, legacy upgrade, throttling, persisted lock flag.
// Pure client logic -- no backend. Run: node scripts/pin-lock-test.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import ts from 'typescript'
import vm from 'node:vm'
const store = new Map()
const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
const exports = {}
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/pinLock.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports, localStorage, crypto: webcrypto, TextEncoder, Uint8Array, Date, JSON, Math, Array, parseInt })
const { setPin, verifyPin, hasPin, isScreenLocked, setScreenLocked, MAX_ATTEMPTS } = exports

await setPin('4829')
const stored = store.get('pin_hash')
assert.ok(stored.startsWith('v2:'), 'new hashes are salted PBKDF2')
assert.notEqual(stored.split(':')[2], createHash('sha256').update('4829').digest('hex'), 'not a plain sha256 any more')
assert.equal((await verifyPin('4829')).ok, true)
await setPin('4829')
assert.notEqual(store.get('pin_hash'), stored, 'same PIN, different salt, different hash')

// legacy unsalted hash still unlocks once, then is upgraded in place
store.set('pin_hash', createHash('sha256').update('1111').digest('hex'))
assert.equal((await verifyPin('1111')).ok, true)
assert.ok(store.get('pin_hash').startsWith('v2:'), 'legacy hash upgraded after a successful unlock')

// throttling: 5 free wrong tries, then a wait that persists (and refuses even the right PIN)
await setPin('4829')
for (let i = 1; i <= 5; i++) { const r = await verifyPin('0000'); assert.equal(r.ok, false); assert.equal(r.waitMs, 0) }
const sixth = await verifyPin('0000')
assert.ok(sixth.waitMs >= 30_000, 'wait starts after 5 wrong tries')
assert.ok((await verifyPin('4829')).waitMs > 0, 'correct PIN is refused while waiting')
assert.ok(MAX_ATTEMPTS >= 6)

// the lock survives a reload (it is storage, not React state)
setScreenLocked(true); assert.equal(isScreenLocked(), true)
setScreenLocked(false); assert.equal(isScreenLocked(), false)
assert.equal(hasPin(), true)
console.log('PASS: salted PIN, legacy upgrade, throttling, persisted lock flag')
