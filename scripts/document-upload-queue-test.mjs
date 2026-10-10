import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { validateMetadata, validateFile } from '../supabase/functions/_shared/patientFiles.ts'
const rows = new Map()
let userId = 'doctor-a', online = false, failure = null
const sent = [], invalidated = []
class DocumentError extends Error { constructor(message, status) { super(message); this.status = status } }
const storage = { createStore: () => ({}), entries: async () => [...rows], set: async (id, item) => { rows.set(id, structuredClone(item)) }, del: async id => rows.delete(id) }
const auth = { getSession: async () => ({ data: { session: userId ? { user: { id: userId }, access_token: `token-${userId}` } : null } }) }
const source = ts.transpileModule(readFileSync('src/lib/documentUploads.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function load() {
 const exports = {}
 vm.runInNewContext(source, { exports, navigator: { get onLine() { return online } }, FormData, console, require(name) {
   if (name === 'idb-keyval') return storage
   if (name.endsWith('supabase')) return { supabase: { auth } }
   if (name.endsWith('queryClient')) return { queryClient: { invalidateQueries: async query => invalidated.push(query) } }
   if (name.endsWith('patientFiles')) return { validateMetadata, validateFile }
   if (name.endsWith('patientDocuments')) return { DocumentError, documentRequest: async (action, body, token) => { sent.push({ action, token, metadata: JSON.parse(body.get('metadata')), file: body.get('file') }); if (failure) throw failure; return {} } }
   throw new Error(name)
 } })
 return exports
}
const metadata = { id: '40000000-0000-4000-8000-000000000001', clinic_id: '10000000-0000-4000-8000-000000000001', patient_id: '20000000-0000-4000-8000-000000000001', title: 'Synthetic MRI', category: 'MRI', examination_date: null, note: '' }
const file = new Blob(['%PDF-1.4\nsynthetic offline file'], { type: 'application/pdf' })
let queue = load(); await queue.queueDocument(metadata, file)
assert.equal(rows.size, 1); assert.equal(sent.length, 0)
queue = load(); assert.equal(await (await queue.listUploads())[0].file.text(), await file.text())
userId = 'reception-b'; online = true; await queue.drainUploads(); assert.equal(sent.length, 0); await assert.rejects(queue.cancelUpload(metadata.id))
userId = null; await queue.drainUploads(); assert.equal(sent.length, 0)
userId = 'doctor-a'; failure = new DocumentError('Reconnect Drive', 409); await queue.drainUploads()
assert.equal(rows.size, 1); assert.equal((await queue.listUploads())[0].blocked, true)
const attempts = sent.length; await queue.drainUploads(); assert.equal(sent.length, attempts)
failure = null; await queue.drainUploads(true); assert.equal(rows.size, 0); assert.equal(sent.at(-1).token, 'token-doctor-a'); assert.equal(invalidated.length, 1)
console.log('PASS: durable Blob survives reload; only original account replays; explicit retry unblocks reconnect')
online = false; await queue.queueDocument({ ...metadata, id: '40000000-0000-4000-8000-000000000002' }, file)
online = true; failure = new DocumentError('Temporary outage', 503); await queue.drainUploads(); assert.equal(rows.size, 1); assert.equal((await queue.listUploads())[0].blocked, false)
failure = null; await queue.drainUploads(); assert.equal(rows.size, 0)
online = false; await queue.queueDocument(metadata, file); await queue.cancelUpload(metadata.id); assert.equal(rows.size, 0)
console.log('PASS: transient errors retain bytes and retry; original account can remove a pending upload')
