import { MAX_FILE_BYTES, sha256, uuid, validateFile, validateMetadata, type FileMetadata } from '../_shared/patientFiles.ts'

type Config = { supabaseUrl: string; anonKey: string; serviceKey: string; appUrl: string; clientId?: string; clientSecret?: string; encryptionKey?: string }
type Archive = { id: string; clinic_id: string; kind: string; status: string; drive_file_id: string | null; content_sha256: string | null; size_bytes: number | null }
type Connection = { account_id: string; account_email: string; folder_id: string; refresh_token_ciphertext: string | null }
type StoredFile = FileMetadata & { mime_type: string; size_bytes: number; content_sha256: string; drive_file_id: string; status: string; uploaded_by: string }
class Failure extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status } }
const DRIVE = 'https://www.googleapis.com/drive/v3'
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const decode = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0))
export async function encryptToken(text: string, secret: string, clinicId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['encrypt'])
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(clinicId) }, key, new TextEncoder().encode(text))
  return `${encode(iv)}.${encode(new Uint8Array(cipher))}`
}
export async function decryptToken(ciphertext: string, secret: string, clinicId: string) {
  const [iv, cipher] = ciphertext.split('.')
  const key = await crypto.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['decrypt'])
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv), additionalData: new TextEncoder().encode(clinicId) }, key, decode(cipher)))
}
async function limitedBody(req: Request, max: number) {
  const reader = req.body?.getReader()
  if (!reader) throw new Failure(400, 'A request body is required.')
  const chunks: Uint8Array[] = []; let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.length
    if (total > max) { await reader.cancel(); throw new Failure(413, 'The file is too large. Maximum 25 MB.') }
    chunks.push(next.value)
  }
  return new Blob(chunks as BlobPart[])
}
export function createHandler(config: Config, fetcher: typeof fetch = fetch) {
  const app = new URL(config.appUrl)
  const redirectUri = `${app.origin}${app.pathname.replace(/\/$/, '')}/?drive_callback=1`
  let configured = false
  try { configured = !!config.clientId && !!config.clientSecret && !!config.encryptionKey && decode(config.encryptionKey).length === 32 } catch { /* Invalid configuration stays unavailable. */ }
  async function db<T>(table: string, params: Record<string, string> = {}, method = 'GET', body?: unknown): Promise<T> {
    const response = await fetcher(`${config.supabaseUrl}/rest/v1/${table}?${new URLSearchParams(params)}`, {
      method, headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, 'Content-Type': 'application/json', Prefer: method === 'POST' ? 'return=representation,resolution=ignore-duplicates' : 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) throw new Failure(503, 'Document storage is unavailable. Retry after setup or reconnection.')
    return response.status === 204 ? undefined as T : response.json()
  }
  async function google(url: string, token: string, options: RequestInit = {}) {
    const response = await fetcher(url, { ...options, redirect: 'error', headers: { ...options.headers, Authorization: `Bearer ${token}` } })
    if (response.status === 401) throw new Failure(409, 'Reconnect the clinic Google Drive account.')
    if (response.status === 403) throw new Failure(409, 'Google Drive denied access. Check storage space and permissions.')
    if (response.status === 404) throw new Failure(404, 'The file or folder is no longer available in Google Drive.')
    if (!response.ok && response.status !== 409) throw new Failure(503, 'Google Drive is unavailable. Try again.')
    return response
  }
  async function tokenRequest(params: Record<string, string>) {
    const response = await fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, client_id: config.clientId!, client_secret: config.clientSecret! }) })
    if (!response.ok) throw new Failure(response.status >= 500 || response.status === 429 ? 503 : 409, 'Reconnect the clinic Google Drive account.')
    const tokens = await response.json()
    if (typeof tokens.access_token !== 'string') throw new Failure(503, 'Google did not return access. Try connecting again.')
    return tokens as { access_token: string; refresh_token?: string; scope?: string }
  }
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('Origin')
    const headers = { 'Access-Control-Allow-Origin': app.origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' }
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
    try {
      if (origin && origin !== app.origin) throw new Failure(403, 'This app origin is not permitted.')
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
      if (req.method !== 'POST') throw new Failure(405, 'Use POST.')
      const authorization = req.headers.get('Authorization')
      if (!authorization?.startsWith('Bearer ')) throw new Failure(401, 'Sign in to the clinic app.')
      // Validate the JWT with Auth; never trust decoded claims or a supplied user ID.
      const authResponse = await fetcher(`${config.supabaseUrl}/auth/v1/user`, { headers: { Authorization: authorization, apikey: config.anonKey } })
      if (!authResponse.ok) throw new Failure(401, 'Sign in to the clinic app again.')
      const user = await authResponse.json()
      if (!uuid(user.id)) throw new Failure(401, 'Sign in to the clinic app again.')
      const action = new URL(req.url).searchParams.get('action')
      const raw = await limitedBody(req, (action === 'upload' || action === 'archive-upload') ? MAX_FILE_BYTES + 16384 : 16384)
      let input: Record<string, unknown>; let file: File | undefined
      try {
        if (action === 'upload' || action === 'archive-upload') {
          const form = await new Response(raw, { headers: { 'Content-Type': req.headers.get('Content-Type') ?? '' } }).formData()
          input = JSON.parse(String(form.get('metadata')))
          const entry = form.get('file')
          if (!(entry instanceof File)) throw new Error('missing file')
          file = entry
        } else input = JSON.parse(await raw.text())
        if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('invalid input')
      } catch { throw new Failure(400, 'Invalid document request.') }
      const clinicId = input.clinic_id
      if (!uuid(clinicId)) throw new Failure(400, 'Choose a clinic.')
      const archiveAction = action === 'archive-upload' || action === 'archive-content'
      if (archiveAction && !uuid(input.id)) throw new Failure(400, 'Invalid archive reference.')
      const [archive] = archiveAction ? await db<Archive[]>('document_archives', {id: `eq.${input.id}`, clinic_id: `eq.${clinicId}`, select: 'id,clinic_id,kind,status,drive_file_id,content_sha256,size_bytes', limit: '1'}) : []
      if (archiveAction && !archive) throw new Failure(404, 'Archive not found.')
      const roles = await db<{ role: string }[]>('user_roles', { select: 'role', user_id: `eq.${user.id}`, clinic_id: `eq.${clinicId}`, role: archive?.kind === 'receipt' ? 'in.(doctor,receptionist)' : 'eq.doctor', limit: '1' })
      if (!roles.length) throw new Failure(403, 'Only the clinic doctor can access patient documents.')
      if (action === 'status' && !configured) return json({ configured: false, connected: false })
      if (!configured) throw new Failure(503, 'Google Drive setup is not complete yet.')
      const [connection] = await db<Connection[]>('clinic_drive_connections', { clinic_id: `eq.${clinicId}`, limit: '1' })
      if (action === 'status') {
        let connected = !!connection?.refresh_token_ciphertext
        if (connected) {
          try { await tokenRequest({ refresh_token: await decryptToken(connection.refresh_token_ciphertext!, config.encryptionKey!, clinicId), grant_type: 'refresh_token' }) }
          catch (error) { if (error instanceof Failure && error.status === 409) connected = false; else throw error }
        }
        return json({ configured: true, connected, email: connection?.account_email ?? null })
      }
      if (action === 'connect') {
        const state = encode(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
        await db('clinic_drive_oauth_states', { expires_at: `lt.${new Date().toISOString()}` }, 'DELETE')
        await db('clinic_drive_oauth_states', {}, 'POST', { state_hash: await sha256(state), clinic_id: clinicId, user_id: user.id, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() })
        const params = new URLSearchParams({ client_id: config.clientId!, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent select_account', state })
        return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, state })
      }
      if (action === 'complete') {
        if (typeof input.code !== 'string' || input.code.length > 4096 || typeof input.state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.state)) throw new Failure(400, 'Invalid connection response.')
        const states = await db<unknown[]>('clinic_drive_oauth_states', { state_hash: `eq.${await sha256(input.state)}`, clinic_id: `eq.${clinicId}`, user_id: `eq.${user.id}`, expires_at: `gt.${new Date().toISOString()}` }, 'DELETE')
        if (states.length !== 1) throw new Failure(409, 'This connection attempt expired or was already used. Start again.')
        const tokens = await tokenRequest({ code: input.code, redirect_uri: redirectUri, grant_type: 'authorization_code' })
        if (!tokens.refresh_token || !tokens.scope?.split(' ').includes(SCOPE)) throw new Failure(409, 'Approve file access when connecting Google Drive.')
        const account = await (await google(`${DRIVE}/about?fields=user(permissionId,emailAddress)`, tokens.access_token)).json()
        if (!account.user?.permissionId || !account.user?.emailAddress) throw new Failure(503, 'Could not identify the connected Google account.')
        if (connection && connection.account_id !== account.user.permissionId) throw new Failure(409, 'Reconnect the same clinic Google account to keep existing documents accessible.')
        let folderId = connection?.folder_id
        if (!folderId) {
          const folder = await (await google(`${DRIVE}/files?fields=id`, tokens.access_token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Clinic patient documents', mimeType: 'application/vnd.google-apps.folder' }) })).json()
          folderId = folder.id
        }
        if (typeof folderId !== 'string') throw new Failure(503, 'Could not create the private document folder.')
        await db('rpc/save_clinic_drive_connection', {}, 'POST', { p_clinic_id: clinicId, p_user_id: user.id, p_account_id: account.user.permissionId, p_email: account.user.emailAddress, p_folder_id: folderId, p_ciphertext: await encryptToken(tokens.refresh_token, config.encryptionKey!, clinicId) })
        return json({ connected: true })
      }
      if (action === 'disconnect') {
        // Keep the account/folder identity and files so reconnect cannot orphan history.
        await db('clinic_drive_connections', { clinic_id: `eq.${clinicId}` }, 'PATCH', { refresh_token_ciphertext: null })
        return json({ connected: false })
      }
      if (!connection?.refresh_token_ciphertext) throw new Failure(409, 'Connect the clinic Google Drive account first.')
      if (archiveAction && archive) {
        const token = (await tokenRequest({ grant_type: 'refresh_token', refresh_token: await decryptToken(connection.refresh_token_ciphertext, config.encryptionKey!, clinicId) })).access_token
        const match = {id: `eq.${archive.id}`, clinic_id: `eq.${clinicId}`}
        if (action === 'archive-content') {
          if (archive.status !== 'ready' || !archive.drive_file_id) throw new Failure(409, 'This PDF is not uploaded yet.')
          const response = await google(`${DRIVE}/files/${encodeURIComponent(archive.drive_file_id)}?alt=media`, token)
          const blob = await limitedBody(new Request('https://local.invalid', {method:'POST', body:response.body, duplex:'half'} as RequestInit), MAX_FILE_BYTES)
          if (await sha256(await blob.arrayBuffer()) !== archive.content_sha256) throw new Failure(409, 'The archived file changed in Google Drive.')
          return new Response(blob, {headers:{...headers, 'Content-Type':'application/pdf', 'Content-Disposition':`attachment; filename="${archive.kind}-${archive.id}.pdf"`, 'Content-Security-Policy':"sandbox; default-src 'none'"}})
        }
        if (file?.type !== 'application/pdf') throw new Failure(400, 'An archive must be a PDF.')
        try { await validateFile(file) } catch (error) { throw new Failure(400, (error as Error).message) }
        if (archive.status === 'ready') return json({id:archive.id})
        const lease = crypto.randomUUID()
        const [claimed] = await db<Archive[]>('rpc/claim_document_archive', {}, 'POST', {p_id:archive.id,p_lease_id:lease})
        if (!claimed) throw new Failure(503, 'Another device is uploading this PDF. It will retry automatically.')
        const leased = {...match, lease_id:`eq.${lease}`}
        try {
          let record = claimed
          // A previous upload may have finished just before its response was lost.
          if (record.drive_file_id && record.content_sha256) {
            const existing = await fetcher(`${DRIVE}/files/${encodeURIComponent(record.drive_file_id)}?fields=id,size,mimeType,sha256Checksum,trashed`, {redirect:'error',headers:{Authorization:`Bearer ${token}`}})
            if (existing.ok) {
              const saved = await existing.json()
              if (saved.trashed || saved.mimeType !== 'application/pdf' || Number(saved.size) !== Number(record.size_bytes) || saved.sha256Checksum !== record.content_sha256) throw new Failure(409, 'The archived file changed in Google Drive.')
              await db('document_archives', leased, 'PATCH', {status:'ready',ready_at:new Date().toISOString(),last_error:null})
              return json({id:record.id})
            }
            if (existing.status !== 404) throw new Failure(503, 'Google Drive is unavailable. Try again.')
          }
          const hash = await sha256(await file.arrayBuffer())
          if (!record.drive_file_id) {
            const ids = await (await google(`${DRIVE}/files/generateIds?count=1&space=drive&type=files`, token)).json()
            if (typeof ids.ids?.[0] !== 'string') throw new Failure(503, 'Could not prepare the archive upload.')
            record = {...record,drive_file_id:ids.ids[0]}
          }
          await db('document_archives', leased, 'PATCH', {drive_file_id:record.drive_file_id,content_sha256:hash,size_bytes:file.size})
          const init = await google('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', token, {method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/pdf','X-Upload-Content-Length':String(file.size)},body:JSON.stringify({id:record.drive_file_id,name:`${record.kind}-${record.id}.pdf`,mimeType:'application/pdf',parents:[connection.folder_id]})})
          if (init.status !== 409) {
            const location=init.headers.get('Location')
            if (!location || new URL(location).origin !== 'https://www.googleapis.com' || !new URL(location).pathname.startsWith('/upload/drive/')) throw new Failure(503,'Google returned an invalid upload destination.')
            await google(location,token,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:file})
          }
          const saved=await (await google(`${DRIVE}/files/${encodeURIComponent(record.drive_file_id!)}?fields=id,size,mimeType,sha256Checksum,trashed`,token)).json()
          if (saved.trashed || saved.mimeType !== 'application/pdf' || Number(saved.size)!==file.size || saved.sha256Checksum!==hash) throw new Failure(409,'Google Drive could not verify the archived PDF.')
          await db('document_archives',leased,'PATCH',{status:'ready',ready_at:new Date().toISOString(),last_error:null})
          return json({id:record.id})
        } catch (error) {
          await db('document_archives',leased,'PATCH',{last_error:error instanceof Failure ? error.message : 'Archive upload failed. Retry.'})
          throw error
        } finally { await db('document_archives',leased,'PATCH',{lease_id:null,lease_until:null}) }
      }
      const patientId = input.patient_id
      if (!uuid(patientId)) throw new Failure(400, 'Choose a patient.')
      const patients = await db<{ id: string }[]>('patients', { id: `eq.${patientId}`, clinic_id: `eq.${clinicId}`, select: 'id', limit: '1' })
      if (!patients.length) throw new Failure(404, 'Patient not found in this clinic.')
      if (!uuid(input.id)) throw new Failure(400, 'Invalid document reference.')
      const token = (await tokenRequest({ grant_type: 'refresh_token', refresh_token: await decryptToken(connection.refresh_token_ciphertext, config.encryptionKey!, clinicId) })).access_token
      const match = { id: `eq.${input.id}`, patient_id: `eq.${patientId}`, clinic_id: `eq.${clinicId}` }
      let [record] = await db<StoredFile[]>('patient_files', match)
      if (action === 'upload') {
        const metadata = input as unknown as FileMetadata
        try { validateMetadata(metadata); await validateFile(file!) } catch (error) { throw new Failure(400, (error as Error).message) }
        const hash = await sha256(await file!.arrayBuffer())
        if (!record) {
          const ids = await (await google(`${DRIVE}/files/generateIds?count=1&space=drive&type=files`, token)).json()
          if (typeof ids.ids?.[0] !== 'string') throw new Failure(503, 'Could not prepare the upload.')
          await db('patient_files', { on_conflict: 'id' }, 'POST', { id: metadata.id, clinic_id: clinicId, patient_id: patientId, title: metadata.title, category: metadata.category, examination_date: metadata.examination_date, note: metadata.note, status: 'uploading', mime_type: file!.type, size_bytes: file!.size, content_sha256: hash, drive_file_id: ids.ids[0], uploaded_by: user.id })
          ;[record] = await db<StoredFile[]>('patient_files', match)
        }
        if (!record || record.content_sha256 !== hash || record.mime_type !== file!.type || record.size_bytes !== file!.size || record.title !== metadata.title || record.category !== metadata.category || record.note !== metadata.note || record.examination_date !== metadata.examination_date) throw new Failure(409, 'This upload reference belongs to different content. Add it as a new document.')
        if (record.status === 'ready') return json({ id: record.id })
        const init = await google(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`, token, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': file!.type, 'X-Upload-Content-Length': String(file!.size) }, body: JSON.stringify({ id: record.drive_file_id, name: `${record.id}.${file!.type === 'application/pdf' ? 'pdf' : file!.type === 'image/png' ? 'png' : 'jpg'}`, mimeType: file!.type, parents: [connection.folder_id] }) })
        if (init.status !== 409) {
          const location = init.headers.get('Location')
          if (!location || new URL(location).origin !== 'https://www.googleapis.com' || !new URL(location).pathname.startsWith('/upload/drive/')) throw new Failure(503, 'Google returned an invalid upload destination.')
          await google(location, token, { method: 'PUT', headers: { 'Content-Type': file!.type }, body: file })
        }
        const saved = await (await google(`${DRIVE}/files/${encodeURIComponent(record.drive_file_id)}?fields=id,size,mimeType,sha256Checksum,trashed`, token)).json()
        if (saved.trashed || Number(saved.size) !== file!.size || saved.mimeType !== file!.type || saved.sha256Checksum !== hash) throw new Failure(409, 'Google Drive could not verify the uploaded file. Retry the original upload.')
        await db('patient_files', match, 'PATCH', { status: 'ready' })
        return json({ id: record.id })
      }
      if (!record || record.status !== 'ready') throw new Failure(404, 'Document not found.')
      if (action === 'link') return json({ url: `https://drive.google.com/file/d/${encodeURIComponent(record.drive_file_id)}/view` })
      if (action === 'content') {
        const response = await google(`${DRIVE}/files/${encodeURIComponent(record.drive_file_id)}?alt=media`, token)
        const content = await limitedBody(new Request('https://local.invalid', { method: 'POST', body: response.body, duplex: 'half' } as RequestInit), MAX_FILE_BYTES)
        const blob = new Blob([content], { type: record.mime_type })
        try { await validateFile(blob) } catch { throw new Failure(409, 'The stored document type has changed. Upload it again as a new document.') }
        if (await sha256(await blob.arrayBuffer()) !== record.content_sha256) throw new Failure(409, 'This file changed in Google Drive. Upload the revised file as a new document.')
        return new Response(blob, { headers: { ...headers, 'Content-Type': record.mime_type, 'Content-Disposition': 'attachment; filename="patient-document"', 'Content-Security-Policy': "sandbox; default-src 'none'" } })
      }
      throw new Failure(400, 'Unknown document action.')
    } catch (error) {
      return json({ error: error instanceof Failure ? error.message : 'The document request failed. Try again.' }, error instanceof Failure ? error.status : 503)
    }
  }
}
