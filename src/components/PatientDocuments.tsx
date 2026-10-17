import { DocumentArchives } from './DocumentArchives'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDate, formatDateOnly } from '../lib/date'
import { connectDrive, documentRequest, type DriveStatus, type PatientFile } from '../lib/patientDocuments'
import { cancelUpload, drainUploads, listUploads, queueDocument, subscribeUploads, type DocumentUpload } from '../lib/documentUploads'
import { FILE_CATEGORIES, validateFile } from '../../supabase/functions/_shared/patientFiles'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useConfirm } from '../lib/confirm'
import { lockPageScroll } from '../lib/scrollLock'
import './PatientDocuments.css'

export function PatientDocuments({ clinicId, patientId, locked = false }: { clinicId: string; patientId: string; locked?: boolean }) {
  const client = useQueryClient()
  const confirm = useConfirm()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<string>('Other')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState<DocumentUpload[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [limit, setLimit] = useState(50)
  const [preview, setPreview] = useState<{ url: string; driveUrl: string; file: PatientFile } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const previewVersion = useRef(0)
  useLayoutEffect(() => {
    const invalidate = () => { previewVersion.current++ }
    invalidate()
    return invalidate
  }, [locked])
  const status = useQuery({ queryKey: ['drive-status', clinicId], queryFn: () => documentRequest<DriveStatus>('status', { clinic_id: clinicId }), retry: false })
  const files = useQuery({ queryKey: ['patient-files', clinicId, patientId, limit], enabled: !!status.data?.configured, queryFn: async () => {
    const { data, error } = await supabase.from('patient_files').select('id, clinic_id, patient_id, title, category, examination_date, note, mime_type, size_bytes, created_at, status').eq('clinic_id', clinicId).eq('patient_id', patientId).eq('status', 'ready').order('created_at', { ascending: false }).order('id').limit(limit + 1)
    if (error) throw error
    return data as PatientFile[]
  } })
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const uploads = await listUploads()
      if (alive) setPending(uploads.filter(item => item.ownerId === session?.user.id && item.clinicId === clinicId && item.metadata.patient_id === patientId))
    }
    void refresh()
    const unsubscribe = subscribeUploads(() => { void refresh() })
    return () => { alive = false; unsubscribe() }
  }, [clinicId, patientId])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])
  useLayoutEffect(() => {
    if (!preview || locked) return
    const previous = returnFocus.current
    const modal = dialog.current
    modal?.showModal()
    const unlockScroll = lockPageScroll()
    return () => { modal?.close(); unlockScroll(); previous?.focus() }
  }, [preview, locked])
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (error) { setError(error instanceof Error ? error.message : 'Could not complete the document action.') } finally { setBusy(false) }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!file) return
    await run(async () => {
      await queueDocument({ id: crypto.randomUUID(), clinic_id: clinicId, patient_id: patientId, title: title.trim(), category, examination_date: date || null, note: note.trim() }, file)
      setFile(null); setTitle(''); setNote(''); setDate(''); if (input.current) input.current.value = ''
    })
  }
  async function open(record: PatientFile) {
    const version = previewVersion.current
    returnFocus.current = document.activeElement as HTMLElement | null
    await run(async () => {
      const blob = await documentRequest<Blob>('content', { clinic_id: clinicId, patient_id: patientId, id: record.id }, undefined, true)
      const result = await documentRequest<{ url: string }>('link', { clinic_id: clinicId, patient_id: patientId, id: record.id })
      if (new URL(result.url).origin !== 'https://drive.google.com') throw new Error('Invalid Drive link.')
      if (version !== previewVersion.current) return
      setPreview({ url: URL.createObjectURL(blob), driveUrl: result.url, file: record })
    })
  }
  return <section className="patient-documents" aria-label="Patient documents">
    <DocumentArchives clinicId={clinicId} patientId={patientId} locked={locked} />
    <header className="documents-heading"><div><h2 className="readout-heading">Documents</h2><p className="field-hint">Scans, photos and reports · PDF, JPG or PNG · up to 25 MB each</p></div>
      <Button variant="ghost" disabled={busy || !status.data?.configured} onClick={() => void run(() => connectDrive(clinicId))}>{status.data?.connected ? 'Reconnect Drive' : 'Connect Google Drive'}</Button>
    </header>
    <div className="documents-storage" role="status">
      {status.fetchStatus === 'paused' ? 'Offline. You can add files on this device; viewing saved files and syncing need a connection.' : status.isPending ? 'Checking document storage…' : status.isError ? 'Document storage is not available yet. Setup must be completed before files can sync.' : !status.data?.configured ? 'Google Drive setup is pending. Files you add stay on this device until the clinic account is connected.' : status.data.connected ? `Connected to ${status.data.email}. Files remain private.` : 'Connect the clinic Google account. Pending files stay on this device until connected.'}
      {status.isError && <Button variant="ghost" onClick={() => void status.refetch()}>Try again</Button>}
      {status.data?.connected && <Button variant="ghost" disabled={busy} onClick={async () => { if (await confirm({ title: 'Disconnect Google Drive?', body: 'Existing files stay in Drive. Pending uploads will wait until you reconnect.', confirmLabel: 'Disconnect' })) void run(async () => { await documentRequest('disconnect', { clinic_id: clinicId }); await client.invalidateQueries({ queryKey: ['drive-status', clinicId] }) }) }}>Disconnect</Button>}
    </div>
    <form className="document-upload-form" onSubmit={submit}>
      <label className="field"><span className="field-label">File</span><input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" disabled={busy} required onChange={e => { const next = e.target.files?.[0]; setFile(null); if (next) void run(async () => { await validateFile(next); setFile(next); if (!title) setTitle(next.name.replace(/\.[^.]+$/, '').slice(0, 160)) }) }} /></label>
      <label className="field"><span className="field-label">Title</span><Input value={title} onChange={e => setTitle(e.target.value)} maxLength={160} required placeholder="e.g. Lumbar spine MRI report" /></label>
      <fieldset className="document-categories"><legend className="field-label">Category</legend>{FILE_CATEGORIES.map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</fieldset>
      <label className="field"><span className="field-label">Examination date (optional)</span><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="field"><span className="field-label">Note (optional)</span><textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={2} placeholder="A short description" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" disabled={busy || !file || !title.trim()}>{busy ? 'Saving…' : 'Add document'}</Button>
    </form>
    {pending.length > 0 && <section className="documents-pending"><h3>Not saved to Drive yet</h3><p className="field-hint">These files are stored on this device and survive a reload. Keep this device until they finish syncing.</p>{pending.map(item => <article className="document-row" key={item.id}><div><strong>{item.metadata.title}</strong><p>{item.error ?? 'Waiting to upload…'}</p></div><Button variant="ghost" disabled={busy} onClick={async () => { if (await confirm({ title: 'Remove this pending upload?', body: 'It is removed from this device and will not be saved to Drive.', confirmLabel: 'Remove' })) void run(() => cancelUpload(item.id)) }}>Remove</Button></article>)}<Button variant="secondary" disabled={busy} onClick={() => void run(() => drainUploads(true))}>Retry pending uploads</Button></section>}
    <div className="document-list">{files.isError && <p className="form-error">Could not load saved documents. <Button variant="ghost" onClick={() => void files.refetch()}>Try again</Button></p>}
      {files.isLoading && <p className="field-hint">Loading documents…</p>}
      {files.data?.slice(0, limit).map(record => <article className="document-row" key={record.id}><div><strong>{record.title}</strong><p>{record.category} · {record.examination_date ? formatDateOnly(record.examination_date) : formatDate(record.created_at)}</p>{record.note && <p>{record.note}</p>}</div><Button variant="secondary" disabled={busy} onClick={() => void open(record)}>View</Button></article>)}
      {files.data?.length === 0 && <p className="readout-empty">No documents uploaded for this patient yet.</p>}
      {(files.data?.length ?? 0) > limit && <Button variant="secondary" onClick={() => setLimit(limit + 50)}>Show more</Button>}
    </div>
    {preview && !locked && <dialog ref={dialog} className="document-preview" aria-labelledby="patient-document-preview-title" onCancel={e => { e.preventDefault(); setPreview(null) }} onClick={e => { if (e.target === e.currentTarget) setPreview(null) }}><header><h2 id="patient-document-preview-title">{preview.file.title}</h2><Button variant="ghost" onClick={() => setPreview(null)}>Close</Button></header>
      {preview.file.mime_type === 'application/pdf' ? <iframe title={preview.file.title} src={preview.url} /> : <img src={preview.url} alt={preview.file.title} />}
      <footer><a href={preview.url} download={`${preview.file.title}.${preview.file.mime_type === 'application/pdf' ? 'pdf' : preview.file.mime_type === 'image/png' ? 'png' : 'jpg'}`}>Download</a><a href={preview.driveUrl} target="_blank" rel="noopener noreferrer">Open in Drive</a></footer>
    </dialog>}
  </section>
}
