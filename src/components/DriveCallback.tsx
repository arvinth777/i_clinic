import { useEffect, useState } from 'react'
import { documentRequest } from '../lib/patientDocuments'
import { drainUploads } from '../lib/documentUploads'
import { Button } from './ui/button'
import './DriveCallback.css'
// Remove the authorization code before rendering the rest of the app.
const params = new URLSearchParams(window.location.search)
let completion: Promise<unknown> | undefined
async function finish() {
  window.history.replaceState(null, '', window.location.pathname)
  const saved = JSON.parse(sessionStorage.getItem('clinic-drive-oauth') ?? 'null')
  sessionStorage.removeItem('clinic-drive-oauth')
  if (params.has('error')) throw new Error('Google Drive access was not approved. You can connect again from Documents.')
  if (!saved || saved.state !== params.get('state') || !params.get('code')) throw new Error('This connection attempt expired. Start again from Documents.')
  await documentRequest('complete', { clinic_id: saved.clinicId, state: saved.state, code: params.get('code') })
  void drainUploads(true)
}
export function DriveConnectionResult({ status, done, failed = false }: { status: string; done: boolean; failed?: boolean }) {
  return <main className="drive-callback">
    <header className="drive-callback-clinic">Salem Pain &amp; Palliative Care</header>
    <section className="drive-callback-result">
      <p className="field-hint">Patient documents · Google Drive</p>
      <h1>{!done ? 'Connecting Google Drive…' : failed ? 'Connection not completed' : 'Google Drive connected'}</h1>
      <p className={failed ? 'form-error' : done ? 'status-green' : 'field-hint'} role={failed ? 'alert' : 'status'}>{status}</p>
      {done && <Button onClick={() => window.location.assign(window.location.pathname)}>Return to clinic</Button>}
    </section>
  </main>
}
export function DriveCallback() {
  const [status, setStatus] = useState('Connecting Google Drive…')
  const [done, setDone] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let mounted = true
    completion ??= finish()
    completion.then(() => { if (mounted) { setStatus('You can now upload scans and reports to patient records.'); setDone(true) } }, error => { if (mounted) { setStatus(error instanceof Error ? error.message : 'Could not connect Google Drive.'); setFailed(true); setDone(true) } })
    return () => { mounted = false }
  }, [])
  return <DriveConnectionResult status={status} done={done} failed={failed} />
}
