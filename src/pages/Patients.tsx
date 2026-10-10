import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatDate, formatDateOnly } from '../lib/date'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Billing } from '../components/Billing'

type Patient = { id: string; name: string; age: number | null; gender: string | null; phone: string | null; address: string | null }
type Visit = { id: string; arrived_at: string; complaint: string; stage: string; token_number: number; follow_up_date: string | null }
type Prescription = { id: string; visit_id: string; diagnosis: string | null; advice: string | null; prescription_items: { dosage_frequency: string; duration_days: number; strength: string | null; medicines: { name: string } | null }[] }

export function Patients({ clinicId, isDoctor, canBill }: { clinicId: string; isDoctor: boolean; canBill: boolean }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [patient, setPatient] = useState<Patient | null>(null)
  const [tab, setTab] = useState<'visits' | 'notes'>('visits')
  const [billId, setBillId] = useState<string | null>(null)
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer) }, [search])
  const { data: patients, error: searchError } = useQuery({
    queryKey: ['patient-directory', clinicId, query],
    queryFn: async () => {
      const result = query ? await supabase.rpc('search_patients', { p_clinic_id: clinicId, p_query: query }) : await supabase.from('patients').select('id, name, age, gender, phone, address').eq('clinic_id', clinicId).order('created_at', { ascending: false }).limit(50)
      if (result.error) throw result.error
      return result.data as Patient[]
    },
  })
  const { data: visits, error: visitError } = useQuery({
    queryKey: ['patient-history-visits', clinicId, patient?.id], enabled: !!patient,
    queryFn: async () => {
      const { data, error } = await supabase.from('visits').select('id, arrived_at, complaint, stage, token_number, follow_up_date').eq('clinic_id', clinicId).eq('patient_id', patient!.id).order('arrived_at', { ascending: false })
      if (error) throw error
      return data as Visit[]
    },
  })
  const { data: prescriptions, error: prescriptionError } = useQuery({
    queryKey: ['patient-history-prescriptions', clinicId, patient?.id], enabled: !!patient && isDoctor,
    queryFn: async () => {
      const { data, error } = await supabase.from('prescriptions').select('id, visit_id, diagnosis, advice, visits!inner(patient_id), prescription_items(dosage_frequency, duration_days, strength, medicines(name))').eq('clinic_id', clinicId).eq('visits.patient_id', patient!.id).order('created_at', { ascending: false })
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
  return <div className="patients-workspace"><aside className="record-sidebar">
    <h2 className="readout-heading">Patients</h2>
    <Input aria-label="Search patients" placeholder="Name, phone or token" value={search} onChange={e => setSearch(e.target.value)} />
    <p className="field-hint">{query ? 'Search results' : 'Recently added patients'}</p>
    {searchError && <p className="form-error">Couldn't load patients.</p>}
    {patients?.map(p => <button key={p.id} className="record-selector" aria-pressed={p.id === patient?.id} onClick={() => { setPatient(p); setBillId(null); setTab('visits') }}><strong>{p.name}</strong><small>{[p.age != null ? `${p.age} years` : '', p.gender, p.phone].filter(Boolean).join(' · ')}</small></button>)}
    {patients?.length === 0 && <p className="readout-empty">No matching patients.</p>}
  </aside><div className="patient-record">
    {!patient ? <><h1>Patients</h1><p className="readout-empty">Choose a patient to see their details and visit history.</p></> : billId ? <Billing key={billId} clinicId={clinicId} visitId={billId} onClose={() => setBillId(null)} /> : <>
      <header className="patient-record-heading"><p className="field-hint">Patient record</p><h1>{patient.name}</h1><p>{[patient.age != null ? `${patient.age} years` : '', patient.gender, patient.phone].filter(Boolean).join(' · ')}</p>{patient.address && <p className="field-hint">{patient.address}</p>}</header>
      <div className="flow-stats"><div className="flow-stat"><strong className="flow-stat-value">{visits?.length ?? '—'}</strong><span className="flow-stat-label">Visits</span></div><div className="flow-stat"><strong className="flow-stat-value">{visits?.[0] ? formatDate(visits[0].arrived_at) : '—'}</strong><span className="flow-stat-label">Last visit</span></div><div className="flow-stat"><strong className="flow-stat-value">{visits?.[0]?.follow_up_date ? formatDateOnly(visits[0].follow_up_date) : '—'}</strong><span className="flow-stat-label">Review date</span></div></div>
      <nav className="admin-tabs" aria-label="Patient record"><button className="shell-nav-item" aria-current={tab === 'visits' ? 'page' : undefined} onClick={() => setTab('visits')}>Visits{isDoctor ? ' & prescriptions' : ''}</button>{isDoctor && <button className="shell-nav-item" aria-current={tab === 'notes' ? 'page' : undefined} onClick={() => setTab('notes')}>Personal notes</button>}</nav>
      {(visitError || prescriptionError || noteError) && <p className="form-error">Couldn't load part of this patient record. Reconnect and try again.</p>}
      {tab === 'visits' ? <div className="patient-history">{visits?.map(v => <article key={v.id} className="history-row"><div><time>{formatDate(v.arrived_at)}</time><p className="field-hint">#{v.token_number} · {v.stage.replaceAll('_', ' ')}</p></div><div><h3>{v.complaint || 'No complaint recorded'}</h3>{prescriptions?.filter(p => p.visit_id === v.id).map(p => <div key={p.id}>{p.diagnosis && <p>{p.diagnosis}</p>}<ul className="patient-medicines">{p.prescription_items.map((item, i) => <li key={i}>{item.medicines?.name} {item.strength}<span>{item.dosage_frequency} · {item.duration_days} days</span></li>)}</ul>{p.advice && <p className="field-hint">Advice / investigations: {p.advice}</p>}</div>)}{canBill && v.stage === 'paid' && <Button variant="ghost" onClick={() => setBillId(v.id)}>View receipt →</Button>}</div></article>)}{visits?.length === 0 && <p className="readout-empty">No visits recorded.</p>}</div> : <div className="patient-history">{notes?.map(note => <article className="history-row" key={note.id}><time>{formatDate(note.created_at)}</time><p>{note.body}</p></article>)}{notes?.length === 0 && <p className="readout-empty">No personal notes recorded.</p>}</div>}
    </>}
  </div></div>
}
