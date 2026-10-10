import assert from 'node:assert/strict'
import { createHandler, encryptToken, decryptToken } from '../supabase/functions/patient-documents/handler.ts'
import { sha256, validateMetadata, validateFile, MAX_FILE_BYTES } from '../supabase/functions/_shared/patientFiles.ts'
const clinic = '10000000-0000-4000-8000-000000000001'
const patient = '20000000-0000-4000-8000-000000000001'
const doctor = '30000000-0000-4000-8000-000000000001'
const id = '40000000-0000-4000-8000-000000000001'
const key = Buffer.alloc(32, 7).toString('base64')
const config = { supabaseUrl: 'https://synthetic.supabase.test', anonKey: 'test-anon', serviceKey: 'test-service', appUrl: 'https://clinic.test', clientId: 'test-client', clientSecret: 'test-secret', encryptionKey: key }
const file = new File(['%PDF-1.4\nsynthetic fixture only'], 'scan.pdf', { type: 'application/pdf' })
const metadata = { id, clinic_id: clinic, patient_id: patient, title: 'Synthetic report', category: 'MRI', examination_date: '2026-10-10', note: 'Not real patient data <script>' }
let connection, record, oauthState, uploaded = false, creations = 0, uploadRequests = 0, failReady = false, foreignAccount = false, deniedRole = false, downloads = 0
const requests = []
const result = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } })
async function fakeFetch(address, init = {}) {
  const url = new URL(address); const method = init.method ?? 'GET'; requests.push({ address: url.toString(), method, headers: init.headers })
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
  if (url.pathname === '/auth/v1/user') return init.headers.Authorization === 'Bearer valid-doctor' ? result({ id: doctor }) : result({}, 401)
  if (url.pathname.startsWith('/rest/v1/')) {
    assert.equal(init.headers.Authorization, 'Bearer test-service')
    const table = url.pathname.split('/').at(-1)
    if (table === 'user_roles') { assert.equal(url.searchParams.get('user_id'), `eq.${doctor}`); return result(!deniedRole && url.searchParams.get('clinic_id') === `eq.${clinic}` ? [{ role: 'doctor' }] : []) }
    if (table === 'patients') return result(url.searchParams.get('id') === `eq.${patient}` ? [{ id: patient }] : [])
    if (table === 'clinic_drive_connections') {
      if (method === 'PATCH') connection.refresh_token_ciphertext = null
      return result(connection ? [connection] : [])
    }
    if (table === 'clinic_drive_oauth_states') {
      if (method === 'POST') { oauthState = body; return result([body]) }
      if (method === 'DELETE' && url.searchParams.has('state_hash')) {
        const match = oauthState && `eq.${oauthState.state_hash}` === url.searchParams.get('state_hash') && new Date(oauthState.expires_at).getTime() > Date.now()
        const value = match ? [oauthState] : []; if (match) oauthState = null; return result(value)
      }
      return result([])
    }
    if (table === 'save_clinic_drive_connection') { connection = { account_id: body.p_account_id, account_email: body.p_email, folder_id: body.p_folder_id, refresh_token_ciphertext: body.p_ciphertext }; return result(null) }
    if (table === 'patient_files') {
      if (method === 'POST' && !record) { record = body; assert.equal(body.status, 'uploading'); assert.equal(body.uploaded_by, doctor) }
      if (method === 'PATCH') { if (failReady) { failReady = false; return result({}, 503) } record = { ...record, ...body } }
      return result(record && url.searchParams.get('id') === `eq.${record.id}` && url.searchParams.get('patient_id') === `eq.${record.patient_id}` ? [record] : method === 'POST' ? [record] : [])
    }
    throw new Error(`Unexpected table ${table}`)
  }
  if (url.origin === 'https://oauth2.googleapis.com') return result({ access_token: 'test-google-token', refresh_token: 'test-refresh', scope: 'https://www.googleapis.com/auth/drive.file' })
  assert.equal(init.headers.Authorization, 'Bearer test-google-token')
  if (url.pathname === '/drive/v3/about') return result({ user: { permissionId: foreignAccount ? 'other-account' : 'clinic-account', emailAddress: 'clinic@example.test' } })
  if (url.pathname === '/drive/v3/files' && method === 'POST') return result({ id: 'private-folder' })
  if (url.pathname.endsWith('/generateIds')) return result({ ids: ['generated-file-id'] })
  if (url.pathname === '/upload/drive/v3/files') {
    creations++
    if (uploaded) return result({}, 409)
    assert.equal(body.name, `${id}.pdf`); assert.deepEqual(body.parents, ['private-folder'])
    return result({}, 200, { Location: 'https://www.googleapis.com/upload/drive/v3/files/session-test' })
  }
  if (url.pathname.endsWith('/session-test')) { uploadRequests++; uploaded = true; return result({ id: 'generated-file-id' }) }
  if (url.pathname === '/drive/v3/files/generated-file-id') {
    if (url.searchParams.get('alt') === 'media') { downloads++; return new Response(file) }
    return result({ id: 'generated-file-id', size: String(file.size), mimeType: file.type, sha256Checksum: await sha256(await file.arrayBuffer()), trashed: false })
  }
  throw new Error(`Unexpected external request ${url}`)
}
const handler = createHandler(config, fakeFetch)
async function request(action, body = { clinic_id: clinic }, token = 'valid-doctor', origin = 'https://clinic.test') {
  return handler(new Request(`https://edge.test/patient-documents?action=${action}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: origin, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: body instanceof FormData ? body : JSON.stringify(body) }))
}
function upload(meta = metadata, value = file) { const form = new FormData(); form.set('metadata', JSON.stringify(meta)); form.set('file', value); return form }
assert.equal((await request('status', undefined, 'invalid')).status, 401)
assert.equal((await request('status', undefined, undefined, 'https://evil.test')).status, 403)
assert.equal((await request('status', { clinic_id: patient })).status, 403)
deniedRole = true; assert.equal((await request('status')).status, 403); deniedRole = false
const unconfigured = createHandler({ ...config, clientId: undefined }, fakeFetch)
assert.deepEqual(await (await unconfigured(new Request('https://edge.test/?action=status', { method: 'POST', headers: { Authorization: 'Bearer valid-doctor' }, body: JSON.stringify({ clinic_id: clinic }) }))).json(), { configured: false, connected: false })
console.log('PASS: authenticated doctor, clinic and origin checks; honest unconfigured status')
const cipher = await encryptToken('test-refresh', key, clinic)
assert.equal(await decryptToken(cipher, key, clinic), 'test-refresh')
await assert.rejects(decryptToken(cipher, key, patient)); await assert.rejects(decryptToken(cipher.slice(0, -5), key, clinic))
let start = await (await request('connect')).json()
assert.equal(new URL(start.url).searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file')
assert.equal((await request('complete', { clinic_id: clinic, code: 'code', state: 'bad' })).status, 400)
assert.equal((await request('complete', { clinic_id: clinic, code: 'code', state: start.state })).status, 200)
assert.equal((await request('complete', { clinic_id: clinic, code: 'code', state: start.state })).status, 409)
assert.ok(!connection.refresh_token_ciphertext.includes('test-refresh'))
const status = await (await request('status')).json(); assert.equal(status.connected, true); assert.ok(!JSON.stringify(status).includes('ciphertext'))
start = await (await request('connect')).json(); foreignAccount = true
assert.equal((await request('complete', { clinic_id: clinic, code: 'code', state: start.state })).status, 409); foreignAccount = false
start = await (await request('connect')).json(); oauthState.expires_at = '2020-01-01'
assert.equal((await request('complete', { clinic_id: clinic, code: 'code', state: start.state })).status, 409)
console.log('PASS: encrypted tokens, narrow OAuth, one-use/expired state and same-account reconnect')
for (const invalid of [new File(['<html>'], 'x.pdf', { type: 'application/pdf' }), new File(['%PDF-'], 'x.svg', { type: 'image/svg+xml' }), new File([], 'x.pdf', { type: 'application/pdf' })]) await assert.rejects(validateFile(invalid))
await validateFile(new Blob([new Uint8Array([255,216,255,224])], { type: 'image/jpeg' }))
await validateFile(new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: 'image/png' }))
assert.throws(() => validateMetadata({ ...metadata, examination_date: '2026-02-30' }))
assert.throws(() => validateMetadata({ ...metadata, title: '' }))
await assert.rejects(validateFile(new Blob([new Uint8Array(MAX_FILE_BYTES + 1)], { type: 'application/pdf' })))
// Materialize wire bytes: Node 24's in-process FormData producer crashes when its stream is cancelled.
const oversized = new Request('https://edge.test/?action=upload', { method: 'POST', headers: { Authorization: 'Bearer valid-doctor', Origin: 'https://clinic.test' }, body: upload(metadata, new File([new Uint8Array(MAX_FILE_BYTES + 32768)], 'huge.pdf', { type: 'application/pdf' })) })
assert.equal((await handler(new Request(oversized.url, { method: 'POST', headers: oversized.headers, body: await oversized.arrayBuffer() }))).status, 413)
assert.equal((await request('upload', upload({ ...metadata, patient_id: id }))).status, 404)
failReady = true
assert.equal((await request('upload', upload({ ...metadata, status: 'ready', drive_file_id: 'forged-id', uploaded_by: patient }))).status, 503)
assert.equal(record.drive_file_id, 'generated-file-id'); assert.equal(record.status, 'uploading'); assert.equal(uploadRequests, 1)
assert.equal((await request('upload', upload())).status, 200); assert.equal(uploadRequests, 1); assert.equal(creations, 2)
assert.equal((await request('upload', upload())).status, 200); assert.equal(creations, 2)
assert.equal((await request('upload', upload({ ...metadata, title: 'changed' }))).status, 409)
assert.equal((await request('upload', upload(metadata, new File(['%PDF-different'], 'new.pdf', { type: 'application/pdf' })))).status, 409)
console.log('PASS: file validation, forged fields, interrupted-upload recovery and idempotent retry')
assert.equal((await request('content', { clinic_id: clinic, patient_id: patient, id: patient })).status, 404)
const content = await request('content', { clinic_id: clinic, patient_id: patient, id })
assert.equal(content.status, 200); assert.equal(await content.text(), await file.text()); assert.equal(content.headers.get('Cache-Control'), 'no-store'); assert.equal(content.headers.get('X-Content-Type-Options'), 'nosniff'); assert.equal(downloads, 1)
assert.equal((await (await request('link', { clinic_id: clinic, patient_id: patient, id })).json()).url, 'https://drive.google.com/file/d/generated-file-id/view')
await request('disconnect'); assert.equal(connection.refresh_token_ciphertext, null)
assert.equal((await request('content', { clinic_id: clinic, patient_id: patient, id })).status, 409)

assert.ok(requests.every(request => !request.address.includes('test-refresh')))
console.log('PASS: private content, access denial, safe links and disconnect without file deletion')
