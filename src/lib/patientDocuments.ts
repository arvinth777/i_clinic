import { supabase } from './supabase'
import type { FileMetadata } from '../../supabase/functions/_shared/patientFiles'
export type PatientFile = FileMetadata & { mime_type: string; size_bytes: number; created_at: string; status: 'uploading' | 'ready' }
export type DriveStatus = { configured: boolean; connected: boolean; email?: string }
export class DocumentError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status } }
export async function documentRequest<T>(action: string, body: object | FormData, accessToken?: string, content = false): Promise<T> {
  const token = accessToken ?? (await supabase.auth.getSession()).data.session?.access_token
  if (!token) throw new DocumentError('Sign in to the clinic app.', 401)
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/patient-documents?action=${action}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
    body: body instanceof FormData ? body : JSON.stringify(body),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    throw new DocumentError(typeof result.error === 'string' ? result.error : 'Document storage is unavailable. Check setup and try again.', response.status)
  }
  return content ? await response.blob() as T : response.json()
}
export async function connectDrive(clinicId: string) {
  const { url, state } = await documentRequest<{ url: string; state: string }>('connect', { clinic_id: clinicId })
  if (new URL(url).origin !== 'https://accounts.google.com') throw new Error('Invalid Google connection URL.')
  sessionStorage.setItem('clinic-drive-oauth', JSON.stringify({ clinicId, state }))
  window.location.assign(url)
}
