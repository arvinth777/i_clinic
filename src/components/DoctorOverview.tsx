import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDate, formatDateOnly } from '../lib/date'
import { formatBody } from '../lib/patientBody'
import { Button } from './ui/button'
import { ConsultationClock } from './ConsultationClock'
import './DoctorOverview.css'

type Item = { molecule_name: string | null; medicines?: { name: string } | null; dosage_frequency: string | null; duration_days: number }
export type OverviewPrescription = { id: string; visit_id: string; diagnosis: string | null; advice: string | null; prescription_items: Item[] }
export type OverviewVisit = {
  id: string; token_number: number; stage: string; complaint: string; sent_in_at: string | null; with_doctor_at: string | null
  patients: { name: string; age: number | null; gender: string | null; address: string | null; phone: string | null; height_cm: number | null; weight_kg: number | null; custom_fields?: Record<string, unknown> | null; is_long_term?: boolean | null } | null
}
type PastVisit = { id: string; arrived_at: string; complaint: string; follow_up_date?: string | null }
type Comment = { id: string; body: string; created_at: string }

const medicineLine = (item: Item) => [item.medicines?.name && !item.molecule_name ? item.medicines.name : item.molecule_name, item.dosage_frequency, `${item.duration_days} d`].filter(Boolean).join(' · ')
const sex = (gender: string | null) => gender === 'Male' ? 'Male' : gender === 'Female' ? 'Female' : gender ?? ''

// "3 weeks ago", from a timestamp; whole days only.
function ago(iso: string): string {
  const days = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 864e5))
  if (days === 0) return 'today'
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}

export function DoctorOverview({ clinicId, visit, pastVisits, prescriptions, comments, noteDraft, onNoteDraft, onAddNote, noteBusy, noteFailed, sent, prescribingActive, busy, onStart, onViewPrescription, onOpenRecord, onCancel }: {
  clinicId: string; visit: OverviewVisit; pastVisits: PastVisit[] | undefined; prescriptions: OverviewPrescription[] | undefined; comments: Comment[] | undefined
  noteDraft: string; onNoteDraft: (text: string) => void; onAddNote: () => void; noteBusy: boolean; noteFailed: boolean
  sent: boolean; prescribingActive: boolean; busy: boolean
  onStart: () => void; onViewPrescription: () => void; onOpenRecord: () => void; onCancel: () => void
}) {
  const patient = visit.patients
  const called = visit.stage === 'called'
  const { data: fields } = useQuery({
    queryKey: ['patient-field-definitions', clinicId], staleTime: 10 * 60_000,
    queryFn: async () => { const { data, error } = await supabase.from('patient_field_definitions').select('key, label, field_type').eq('clinic_id', clinicId).order('display_order'); if (error) throw error; return data as { key: string; label: string; field_type: string }[] },
  })
  const bmi = patient?.height_cm && patient?.weight_kg ? Number(patient.weight_kg) / (Number(patient.height_cm) / 100) ** 2 : null
  const earlier = pastVisits ?? []
  const lastVisit = earlier[0]
  const lastRx = lastVisit ? prescriptions?.find(p => p.visit_id === lastVisit.id) : undefined
  const visitNumber = earlier.length + 1
  const registered = (fields ?? []).map(f => ({ ...f, value: patient?.custom_fields?.[f.key] })).filter(f => f.value !== undefined && f.value !== null && String(f.value).trim() !== '')
  const followUp = lastVisit?.follow_up_date

  return (
    <div className="dv">
      <header className="dv-hero">
        <div className="dv-who">
          <p className="dv-line">
            <span className="dv-token">#{visit.token_number}</span>
            <span className={`dv-state ${called ? 'is-called' : sent ? 'is-sent' : 'is-in'}`}>{called ? 'Called · waiting for reception to send in' : sent ? 'Prescription sent to billing' : visit.sent_in_at ? `In the room since ${new Date(visit.sent_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'With doctor'}</span>
            {visit.stage === 'with_doctor' && visit.with_doctor_at && <ConsultationClock startedAt={visit.with_doctor_at} />}
          </p>
          <h2 className="dv-name">{patient?.name}</h2>
          <p className="dv-facts">
            {pastVisits ? <span className={`dv-tag ${earlier.length ? '' : 'is-new'}`}>{earlier.length ? `Visit ${visitNumber}` : 'New patient'}</span> : null}
            {[patient?.age != null ? `${patient.age} years` : '', sex(patient?.gender ?? null), formatBody(patient?.height_cm, patient?.weight_kg), bmi ? `BMI ${bmi.toFixed(1)}` : '', patient?.phone ?? ''].filter(Boolean).map(text => <span key={text}>{text}</span>)}
          </p>
          {patient?.address && <p className="dv-address">{patient.address}</p>}
        </div>
        <div className="dv-actions">
          {sent
            ? <Button variant="secondary" onClick={onViewPrescription}>View prescription</Button>
            : <Button disabled={called} onClick={onStart}>{prescribingActive ? 'Continue prescription →' : 'Start prescription →'}</Button>}
          <span className="dv-secondary">
            <button type="button" className="dv-link" onClick={onOpenRecord}>Full record</button>
            {visit.stage !== 'paid' && <button type="button" className="dv-link is-danger" disabled={busy} onClick={onCancel}>Cancel visit</button>}
          </span>
        </div>
      </header>

      <section className="dv-reason" aria-label="Reason for visit">
        <p className="dv-label">Reason for visit</p>
        <p className="dv-complaint">{visit.complaint || 'No complaint recorded.'}</p>
        {registered.length > 0 && (
          <dl className="dv-registered">
            {registered.map(field => {
              const scale = /(\d+)\s*[-–]\s*(\d+)/.exec(field.label), n = Number(field.value)
              const meter = scale && Number.isFinite(n) && n >= Number(scale[1]) && n <= Number(scale[2]) ? (n - Number(scale[1])) / (Number(scale[2]) - Number(scale[1])) : null
              return <div key={field.key}><dt>{field.label.replace(/\s*\d+\s*[-–]\s*\d+\s*$/, '')}</dt><dd>{String(field.value)}{scale && meter !== null ? <span className="dv-scale"> / {scale[2]}<i className="dv-meter" style={{ ['--dv-fill' as string]: `${Math.round(meter * 100)}%` }} /></span> : null}</dd></div>
            })}
          </dl>
        )}
      </section>

      {(followUp || patient?.is_long_term) && (
        <p className="dv-notice" role="status">
          {patient?.is_long_term && <span>On regular check-ups.</span>}
          {followUp && <span> Follow-up from the last visit was set for {formatDateOnly(followUp)}.</span>}
        </p>
      )}

      <div className="dv-columns">
        <section aria-label="Last visit">
          <p className="dv-label">Last visit{lastVisit ? ` · ${formatDate(lastVisit.arrived_at)} (${ago(lastVisit.arrived_at)})` : ''}</p>
          {!lastVisit ? <p className="dv-empty">First time at the clinic.</p> : <>
            <p className="dv-complaint-small">{lastVisit.complaint}</p>
            {lastRx?.diagnosis && <p className="dv-diagnosis">{lastRx.diagnosis}</p>}
            {lastRx && lastRx.prescription_items.length > 0 && <ul className="dv-meds">{lastRx.prescription_items.map((item, i) => <li key={i}>{medicineLine(item)}</li>)}</ul>}
            {lastRx?.advice && <p className="dv-advice">{lastRx.advice}</p>}
            {!lastRx && <p className="dv-empty">No prescription was issued.</p>}
          </>}
        </section>
        <section aria-label="Earlier visits">
          <p className="dv-label">Earlier visits</p>
          {earlier.length < 2 ? <p className="dv-empty">{earlier.length ? 'No visits before the last one.' : 'No past visits.'}</p> : <ul className="dv-history">{earlier.slice(1, 4).map(v => {
            const rx = prescriptions?.find(p => p.visit_id === v.id)
            return <li key={v.id}><time>{formatDate(v.arrived_at)}</time><span>{rx?.diagnosis || v.complaint}</span></li>
          })}</ul>}
        </section>
      </div>

      <details className="dv-notes" open={!!comments?.length}>
        <summary><span className="dv-label">Personal notes · only you see these{comments?.length ? ` (${comments.length})` : ''}</span></summary>
        {!!comments?.length && <ul className="comment-list">{comments.map(c => <li key={c.id} className="comment-item"><span className="comment-date">{formatDate(c.created_at)}</span><p>{c.body}</p></li>)}</ul>}
        <form className="action-row" onSubmit={e => { e.preventDefault(); if (noteDraft.trim()) onAddNote() }}>
          <div className="field comment-field"><textarea id="comment-body" aria-label="Personal note" rows={1} placeholder="Write a note about this patient" value={noteDraft} onChange={e => onNoteDraft(e.target.value)} /></div>
          <Button type="submit" variant="secondary" disabled={noteBusy || !noteDraft.trim()}>{noteBusy ? 'Adding…' : 'Add note'}</Button>
        </form>
        {noteFailed && <p className="form-error">Couldn't save the note — try again.</p>}
      </details>
    </div>
  )
}
