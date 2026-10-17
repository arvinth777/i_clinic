import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { connectDrive, documentRequest, type DriveStatus } from '../lib/patientDocuments'
import { supabase } from '../lib/supabase'
import { formatDate, formatDateOnly } from '../lib/date'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { restorePagedCache } from '../lib/pagedCache'
import { Billing } from '../components/Billing'
import { PatientDocuments } from '../components/PatientDocuments'
import { PatientTimeline } from '../components/PatientTimeline'
import { PatientBodyEdit } from '../components/PatientBodyEdit'
import { LoadingRows, QueryError } from '../components/QueryState'
import { formatBody } from '../lib/patientBody'

type Patient = { id: string; name: string; age: number | null; gender: string | null; phone: string | null; address: string | null }
type Visit = { id: string; arrived_at: string; complaint: string; stage: string; token_number: number; follow_up_date: string | null }
type Prescription = { id: string; visit_id: string; created_at: string; diagnosis: string | null; advice: string | null; prescription_items: { dosage_frequency: string; duration_days: number; strength: string | null; medicines: { name: string } | null }[] }

export function Patients({ clinicId, isDoctor, canBill, initialPatientId, locked, initialTab, highlightVisitId }: { clinicId: string; isDoctor: boolean; canBill: boolean; initialPatientId?: string | null; locked: boolean; initialTab?: 'visits' | 'documents'; highlightVisitId?: string }) {
  const client = useQueryClient()
  const [visibleCount, setVisibleCount] = useState(50)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [selectedPatient, setPatient] = useState<Patient | null | undefined>(undefined)
  const {data: requestedPatient} = useQuery({queryKey:['patient-detail',clinicId,initialPatientId],enabled:!!initialPatientId,queryFn:async()=>{const {data,error}=await supabase.from('patients').select('id,name,age,gender,phone,address').eq('clinic_id',clinicId).eq('id',initialPatientId!).single();if(error)throw error;return data as Patient}})
  const patient=selectedPatient===undefined ? requestedPatient??null : selectedPatient
  // search_patients returns a fixed column list without height/weight, so read them for the selected patient.
  const { data: body } = useQuery({ queryKey: ['patient-body', patient?.id], enabled: !!patient, queryFn: async () => { const { data, error } = await supabase.from('patients').select('height_cm, weight_kg').eq('id', patient!.id).single(); if (error) throw error; return data as { height_cm: number | null; weight_kg: number | null } } })
  const [tab, setTab] = useState<'visits' | 'timeline' | 'notes' | 'documents'>(isDoctor && initialTab === 'documents' ? 'documents' : 'visits')
  const [connectionError, setConnectionError] = useState('')
  const drive = useQuery({queryKey:['drive-status',clinicId],enabled:isDoctor && initialTab==='documents' && !patient && !locked,queryFn:()=>documentRequest<DriveStatus>('status',{clinic_id:clinicId}),retry:false,refetchInterval:300_000})
  const [billId, setBillId] = useState<string | null>(null)
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer) }, [search])
  const { data: patientPages, error: searchError, dataUpdatedAt, isPending, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['patient-directory', clinicId, query, 'pages-v2'],
    initialData: () => restorePagedCache(client.getQueryData<{ pages: Patient[][] }>(['patient-directory', clinicId, query, 'pages']), client.getQueryData<Patient[]>(['patient-directory', clinicId, query])),
    initialPageParam: 0,
    getNextPageParam: (last: Patient[], pages: Patient[][]) => !query && last.length === 50 ? pages.length * 50 : undefined,
    queryFn: async ({ pageParam }) => {
      const result = query ? await supabase.rpc('search_patients', { p_clinic_id: clinicId, p_query: query }) : await supabase.from('patients').select('id, name, age, gender, phone, address').eq('clinic_id', clinicId).order('created_at', { ascending: false }).order('id').range(pageParam, pageParam + 49)
      if (result.error) throw result.error
      return result.data as Patient[]
    },
  })
  const patients = patientPages?.pages.flat()
  const { data: visits, error: visitError } = useQuery({
    queryKey: ['patient-history-visits', clinicId, patient?.id, isDoctor], enabled: !!patient,
    queryFn: async () => {
      const { data, error } = await supabase.from('visits').select(isDoctor ? 'id, arrived_at, complaint, stage, token_number, follow_up_date' : 'id, arrived_at, stage, token_number, follow_up_date').eq('clinic_id', clinicId).eq('patient_id', patient!.id).order('arrived_at', { ascending: false })
      if (error) throw error
      return data as unknown as Visit[]
    },
  })
  const { data: prescriptions, error: prescriptionError } = useQuery({
    queryKey: ['patient-history-prescriptions', clinicId, patient?.id], enabled: !!patient && isDoctor,
    queryFn: async () => {
      const { data, error } = await supabase.from('prescriptions').select('id, visit_id, created_at, diagnosis, advice, visits!inner(patient_id), prescription_items(dosage_frequency, duration_days, strength, medicines(name))').eq('clinic_id', clinicId).eq('visits.patient_id', patient!.id).order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as Prescription[]
    },
  })
  const { data: notes, error: noteError } = useQuery({
    queryKey: ['patient-comments', patient?.id], enabled: !!patient && isDoctor,
    queryFn: async () => {
      const { data, error } = await supabase.from('patient_comments').select('id, body, created_at').eq('clinic_id', clinicId).eq('patient_id', patient!.id).order('created_at', { ascending: false })
      if (error) throw error
      return data as { id: string; body: string; created_at: string }[]
    },
  })
  const {data: shortfalls,error:shortfallError}=useQuery({queryKey:['patient-shortfalls',clinicId,patient?.id],enabled:!!patient&&isDoctor,queryFn:async()=>{
    const {data,error}=await supabase.from('bills').select('visit_id,bill_line_items(description,quantity,approved_quantity,shortfall,stock_unit),visits!inner(patient_id)').eq('clinic_id',clinicId).eq('visits.patient_id',patient!.id).is('corrects_bill_id',null)
    if(error)throw error
    return data
  }})
  return <div className={`patients-workspace${patient ? " has-selection" : ""}`}><aside className="record-sidebar">
    <h2 className="readout-heading">Patients</h2>
    <Input className="main-search" aria-label="Search patients" placeholder="Name, phone or token" value={search} onChange={e => { setSearch(e.target.value); setVisibleCount(50) }} />
    <p className="field-hint">{query ? 'Search results' : 'Recently added patients'}</p>
    {searchError && <QueryError retry={() => void refetch()} savedAt={dataUpdatedAt} />}
    {isPending && <LoadingRows label="Loading patients…" />}
    <div className={searchError ? "stale-copy" : undefined}>
    {patients?.slice(0, visibleCount).map(p => <button key={p.id} className="record-selector" aria-pressed={p.id === patient?.id} onClick={() => { setPatient(p); setBillId(null); setTab('visits'); window.scrollTo({ top: 0, behavior: 'instant' }) }}><strong>{p.name}</strong><small>{[p.age != null ? `${p.age} years` : '', p.gender, p.phone].filter(Boolean).join(' · ')}</small></button>)}
    </div>
    {(visibleCount < (patients?.length ?? 0) || hasNextPage) && <Button variant="secondary" disabled={isFetchingNextPage} onClick={async () => { if (visibleCount >= (patients?.length ?? 0) && (await fetchNextPage()).isError) return; setVisibleCount(count => count + 50) }}>{isFetchingNextPage ? 'Loading…' : 'Show more'}</Button>}
    {patients?.length === 0 && <p className="readout-empty">No matching patients.</p>}
  </aside><div className="patient-record">
    {patient && <Button className="mobile-list-back" variant="ghost" onClick={() => { setPatient(null); setBillId(null) }}>← Patients</Button>}
    {!patient ? <section className="patient-empty">
      {isDoctor && initialTab === 'documents' ? <>
        <p className="field-hint">Clinic documents</p>
        <h1>Google Drive</h1>
        <p className="patient-empty-description">Store scans and reports privately in the clinic’s Google account. Choose a patient from the list to upload or view their files.</p>
        <div className="drive-connection">
          <h2>Clinic account</h2>
          {drive.isPending ? <LoadingRows label="Checking Google Drive…" /> : <p className={drive.data?.connected ? 'status-green' : 'field-hint'}>{drive.data?.connected ? 'Connected · ready for patient documents' : 'Connect the clinic account to start uploading.'}</p>}
          <p className="field-hint">Pending uploads stay on this device until they sync.</p>
          {drive.isError && <QueryError retry={() => void drive.refetch()} />}
          {connectionError && <p className="form-error" role="alert">{connectionError}</p>}
          <Button disabled={!drive.data?.configured} onClick={() => void connectDrive(clinicId).catch(() => setConnectionError('Could not start Google connection. Try again.'))}>{drive.data?.connected ? 'Reconnect Drive' : 'Connect Google Drive'}</Button>
        </div>
      </> : <><h1>Patient records</h1><p className="patient-empty-description">Choose a patient from the list to see their details{isDoctor ? ' and visit history' : ''}.</p></>}
    </section> : billId ? <Billing readOnly={!canBill} key={billId} clinicId={clinicId} visitId={billId} onClose={() => setBillId(null)} /> : <>
      <header className="patient-record-heading"><p className="field-hint">Patient record</p><h1>{patient.name}</h1><p>{[patient.age != null ? `${patient.age} years` : '', patient.gender, formatBody(body?.height_cm, body?.weight_kg), patient.phone].filter(Boolean).join(' · ')}</p>{patient.address && <p className="field-hint">{patient.address}</p>}<PatientBodyEdit key={patient.id} clinicId={clinicId} patientId={patient.id} height={body ? body.height_cm : undefined} weight={body ? body.weight_kg : undefined} /></header>
      <div className="flow-stats"><div className="flow-stat"><strong className="flow-stat-value">{visits?.length ?? '—'}</strong><span className="flow-stat-label">Visits</span></div><div className="flow-stat"><strong className="flow-stat-value">{visits?.[0] ? formatDate(visits[0].arrived_at) : '—'}</strong><span className="flow-stat-label">Last visit</span></div><div className="flow-stat"><strong className="flow-stat-value">{visits?.[0]?.follow_up_date ? formatDateOnly(visits[0].follow_up_date) : '—'}</strong><span className="flow-stat-label">Review date</span></div></div>
      <nav className="admin-tabs" aria-label="Patient record"><button className="shell-nav-item" aria-current={tab === 'visits' ? 'page' : undefined} onClick={() => setTab('visits')}>Visits{isDoctor ? ' & prescriptions' : ''}</button><button className="shell-nav-item" aria-current={tab === 'timeline' ? 'page' : undefined} onClick={() => setTab('timeline')}>Timeline</button>{isDoctor && <button className="shell-nav-item" aria-current={tab === 'notes' ? 'page' : undefined} onClick={() => setTab('notes')}>Personal notes</button>}{isDoctor && <button className="shell-nav-item" aria-current={tab === 'documents' ? 'page' : undefined} onClick={() => setTab('documents')}>Documents</button>}</nav>
      {(visitError || prescriptionError || noteError || shortfallError) && <QueryError retry={() => { void client.invalidateQueries({ queryKey: ['patient-history-visits', clinicId, patient.id] }); void client.invalidateQueries({ queryKey: ['patient-history-prescriptions', clinicId, patient.id] }); void client.invalidateQueries({ queryKey: ['patient-comments', patient.id] }); void client.invalidateQueries({queryKey:['patient-shortfalls',clinicId,patient.id]}) }} />}
      {((tab === 'visits' && !visits && !visitError) || (tab === 'notes' && !notes && !noteError)) && <LoadingRows label="Loading patient record…" />}
      {tab === 'documents' && isDoctor ? <PatientDocuments locked={locked} key={patient.id} clinicId={clinicId} patientId={patient.id} /> : tab === 'timeline' ? <PatientTimeline key={patient.id} clinicId={clinicId} patientId={patient.id} isDoctor={isDoctor} visits={visits} prescriptions={prescriptions} onReceipt={setBillId} onDocuments={() => setTab('documents')} /> : tab === 'visits' ? <div className="patient-history">{visits?.map(v => <article key={v.id} className={`history-row${v.id === highlightVisitId ? ' alert-highlight' : ''}`}><div><time>{formatDate(v.arrived_at)}</time><p className="field-hint">#{v.token_number} · {v.stage.replaceAll('_', ' ')}</p></div><div>{isDoctor && <h3>{v.complaint || 'No complaint recorded'}</h3>}{isDoctor && prescriptions?.filter(p => p.visit_id === v.id).map(p => <div key={p.id}>{p.diagnosis && <p>{p.diagnosis}</p>}<ul className="patient-medicines">{p.prescription_items.map((item, i) => <li key={i}>{item.medicines?.name} {item.strength}<span>{item.dosage_frequency} · {item.duration_days} days</span></li>)}</ul>{p.advice && <p className="field-hint">Advice / investigations: {p.advice}</p>}</div>)}{isDoctor && shortfalls?.filter(b=>b.visit_id===v.id).flatMap(b=>b.bill_line_items).filter(l=>l.shortfall>0).map((l,i)=><p className="status-amber" key={i}>{l.description} · {l.quantity} of {l.approved_quantity} {l.stock_unit} supplied · {l.shortfall} not supplied</p>)}{(isDoctor || canBill) && v.stage === 'paid' && <Button variant="ghost" onClick={() => setBillId(v.id)}>View receipt →</Button>}</div></article>)}{visits?.length === 0 && <p className="readout-empty">No visits recorded.</p>}</div> : isDoctor ? <div className="patient-history">{notes?.map(note => <article className="history-row" key={note.id}><time>{formatDate(note.created_at)}</time><p>{note.body}</p></article>)}{notes?.length === 0 && <p className="readout-empty">No personal notes recorded.</p>}</div> : null}
    </>}
  </div></div>
}
