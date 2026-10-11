export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const FILE_CATEGORIES = ['MRI', 'X-ray', 'Lab report', 'Discharge summary', 'Other'] as const
export const FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const
export type FileMetadata = { id: string; clinic_id: string; patient_id: string; title: string; category: string; examination_date: string | null; note: string }
export function uuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) }
export function validateMetadata(value: FileMetadata) {
  if (!uuid(value.id) || !uuid(value.clinic_id) || !uuid(value.patient_id)) throw new Error('Invalid document reference.')
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160) throw new Error('Enter a title of up to 160 characters.')
  if (!(FILE_CATEGORIES as readonly string[]).includes(value.category)) throw new Error('Choose a document category.')
  if (typeof value.note !== 'string' || value.note.length > 2000) throw new Error('Keep notes within 2,000 characters.')
  if (value.examination_date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(value.examination_date) || !Number.isFinite(Date.parse(value.examination_date)) || new Date(value.examination_date).toISOString().slice(0, 10) !== value.examination_date)) throw new Error('Enter a valid examination date.')
}
export async function validateFile(file: Blob) {
  if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('Choose a file between 1 byte and 25 MB.')
  if (!(FILE_TYPES as readonly string[]).includes(file.type)) throw new Error('Choose a PDF, JPG or PNG file.')
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const signature = file.type === 'application/pdf' ? [37, 80, 68, 70, 45] : file.type === 'image/jpeg' ? [255, 216, 255] : [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((byte, i) => bytes[i] === byte)) throw new Error('The file contents do not match its type.')
}
export async function sha256(data: string | ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data)), byte => byte.toString(16).padStart(2, '0')).join('')
}
