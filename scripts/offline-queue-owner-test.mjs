// Exercise the queue's public API with storage and Supabase at the system boundary.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const rows = new Map()
let userId = 'staff-a'
const confirmedBy = []
const sdk = {
  auth: { getSession: async () => ({ data: { session: userId ? { user: { id: userId }, access_token: `token-${userId}` } : null }, error: null }) },
  rpc: () => ({ setHeader: (_name, value) => { confirmedBy.push(value.slice('Bearer token-'.length)); return Promise.resolve({ error: null }) } }),
}
const storage = {
  createStore: () => ({}),
  set: async (key, value) => rows.set(key, value),
  del: async (key) => rows.delete(key),
  entries: async () => [...rows],
}
const source = readFileSync('src/lib/offlineQueue.ts', 'utf8')
function loadQueue() {
  const exports = {}
  const context = vm.createContext({ exports, require: (name) => name === 'idb-keyval' ? storage : { supabase: sdk }, navigator: { onLine: true }, crypto: webcrypto, console })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return exports
}
const first = loadQueue()
await first.enqueue({ kind: 'rpc', rpc: 'confirm_bill', clinicId: 'clinic-a', payload: { p_visit_id: 'visit-a' }, description: 'Synthetic payment' })
userId = 'staff-b'
const refreshed = loadQueue()
await refreshed.drainQueue()
assert.equal(confirmedBy.length, 0, 'a refreshed browser must not replay staff A payment as staff B')
assert.equal((await refreshed.getQueueSnapshot()).length, 1, 'foreign-account work must be preserved')
console.log('PASS: account change preserves pending work without replay')
userId = null
await refreshed.drainQueue()
assert.equal(confirmedBy.length, 0, 'signed-out work must not replay')
userId = 'staff-a'
await refreshed.drainQueue()
assert.deepEqual(confirmedBy, ['staff-a'], 'the original account must be recorded when its payment replays')
assert.equal((await refreshed.getQueueSnapshot()).length, 0)
console.log('PASS: original account resumes its own work after sign-in')
rows.set('legacy', { id: 'legacy', seq: 1, kind: 'rpc', rpc: 'confirm_bill', description: 'Legacy synthetic payment' })
await refreshed.drainQueue()
assert.equal(confirmedBy.length, 1, 'unowned legacy entries must never be assigned to the active account')
assert.equal((await refreshed.getQueueSnapshot()).length, 1)
assert.ok(refreshed.getHalted(), 'legacy work must show that it needs review')
console.log('PASS: legacy work preserved and held for review')
rows.clear()
userId = 'staff-a'
await assert.rejects(refreshed.attemptOrQueue({ clinicId: 'clinic-a', attempt: async (token) => {
  assert.equal(token, 'token-staff-a', 'online attempts use the captured account token')
  userId = 'staff-b'
  return { error: { code: '', status: 0, message: 'Failed to fetch' } }
}, queueItem: () => ({ kind: 'rpc', rpc: 'confirm_bill', description: 'Synthetic login race' }) }), /account changed/)
assert.equal(rows.size, 0, 'an account switch during a failed request cannot reassign the queued write')
console.log('PASS: login race cannot reattribute a failed save')

// A refreshed queue preserves the exact reviewed prices and serial dependency order.
rows.clear()
userId = 'staff-a'
const reviewedLines = [{kind:'medicine',prescription_item_id:'item-a',medicine_id:'medicine-a',quantity:10,stock_unit:'tablet',unit_price_paise:1000}]
const approvalPayload = {p_visit_id:'visit-a',p_request_id:'approval-a',p_final_amount_paise:30000,p_expected_total_paise:35000,p_expected_revision_number:1,p_expected_lines:reviewedLines}
await refreshed.enqueue({kind:'rpc',rpc:'save_prescription',clinicId:'clinic-a',payload:{p_visit_id:'visit-a',p_prescription_id:'prescription-a'},description:'Save prescription'})
await refreshed.enqueue({kind:'rpc',rpc:'approve_visit_pricing',clinicId:'clinic-a',payload:approvalPayload,description:'Approve reviewed bill'})
await refreshed.enqueue({kind:'rpc',rpc:'queue_visit_action',clinicId:'clinic-a',payload:{p_visit_id:'visit-a',p_action:'finish',p_request_id:'finish-a'},description:'Finish consultation'})
let rejectApproval = true
const replayed = []
sdk.rpc = (name,payload) => ({setHeader:async()=>{
  replayed.push(name)
  if(name==='approve_visit_pricing') {
    assert.deepEqual(payload,approvalPayload,'approval must retain reviewed lines, totals and stable request ID across reload')
    if(rejectApproval)return {error:{code:'P0001',message:'Prices changed; review again'}}
  }
  return {error:null}
}})
const reloaded = loadQueue()
await reloaded.drainQueue()
assert.deepEqual(replayed,['save_prescription','approve_visit_pricing'])
assert.equal((await reloaded.getQueueSnapshot()).length,2,'a rejected approval must retain it and the dependent finish')
assert.match(reloaded.getHalted().error,/Prices changed/)
rejectApproval = false
await loadQueue().drainQueue()
assert.deepEqual(replayed,['save_prescription','approve_visit_pricing','approve_visit_pricing','queue_visit_action'])
assert.equal(rows.size,0)
console.log('PASS: refreshed approval keeps reviewed payload and blocks dependent finish until accepted')
