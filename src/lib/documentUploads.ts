import { createStore, entries, set, del } from 'idb-keyval'
import { supabase } from './supabase'
import { queryClient } from './queryClient'
import { DocumentError, documentRequest } from './patientDocuments'
import { validateFile, validateMetadata, type FileMetadata } from '../../supabase/functions/_shared/patientFiles'
export type DocumentUpload = { id: string; ownerId: string; clinicId: string; metadata: FileMetadata; file: Blob; createdAt: string; error?: string; blocked?: boolean }
const store = createStore('clinic-document-uploads', 'files')
const listeners = new Set<() => void>()
let draining = false
export function subscribeUploads(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
function notify() { for (const listener of listeners) listener() }
export async function listUploads() { return (await entries<string, DocumentUpload>(store)).map(([, upload]) => upload).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }
export async function queueDocument(metadata: FileMetadata, file: Blob) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sign in before adding a document.')
  validateMetadata(metadata); await validateFile(file)
  const current = (await supabase.auth.getSession()).data.session
  if (current?.user.id !== session.user.id) throw new Error('Your account changed. Return to the account that selected this file.')
  const upload = { id: metadata.id, ownerId: session.user.id, clinicId: metadata.clinic_id, metadata, file, createdAt: new Date().toISOString() }
  await set(upload.id, upload, store)
  notify()
  void drainUploads()
}
export async function cancelUpload(id: string) {
  const { data: { session } } = await supabase.auth.getSession()
  const upload = (await listUploads()).find(item => item.id === id)
  if (!upload || session?.user.id !== upload.ownerId) throw new Error('Return to the account that added this file.')
  if (draining) throw new Error('Wait for the current upload before removing a pending file.')
  await del(id, store); notify()
}
export async function drainUploads(retryBlocked = false) {
  if (draining || !navigator.onLine) return
  draining = true
  try {
    for (const upload of await listUploads()) {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session || !navigator.onLine) return
      if (session.user.id !== upload.ownerId || (upload.blocked && !retryBlocked)) continue
      try {
        const form = new FormData()
        form.set('metadata', JSON.stringify(upload.metadata)); form.set('file', upload.file, 'document')
        await documentRequest('upload', form, session.access_token)
        await del(upload.id, store)
        await queryClient.invalidateQueries({ queryKey: ['patient-files', upload.clinicId, upload.metadata.patient_id] })
      } catch (error) {
        const blocked = error instanceof DocumentError && error.status < 500 && error.status !== 429
        await set(upload.id, { ...upload, blocked, error: error instanceof DocumentError ? error.message : 'Connection interrupted. The file is still pending on this device.' }, store)
      }
      notify()
    }
  } finally { draining = false; notify() }
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void drainUploads())
  setInterval(() => { if (navigator.onLine) void drainUploads() }, 15_000)
}
