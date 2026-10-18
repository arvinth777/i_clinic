import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatPaise } from '../lib/money'
import { clinicToday, elapsedMinutes, formatElapsed, startOfToday } from '../lib/date'
import { Button } from './ui/button'
import { Icon, type IconName } from './Icon'
import { StatusPill } from './StatusPill'
import './DoctorHome.css'

type BoardVisit = { id: string; token_number: number; stage: string; arrived_at: string; patients: { name: string } | null }
const SHOWN = 5

// What the doctor sees when nobody is in the consultation room: a briefing for the day. The numbers, a three-column board of
// where today's patients are (waiting, paying at reception, done), and a short list of things that need attention.
export function DoctorHome({ clinicId, busy, onCallNext, onNavigate, earlierOpen }: {
  clinicId: string; busy: boolean; onCallNext: () => void; onNavigate: (section: string) => void; earlierOpen: number
}) {
  const clinic = useQuery({
    queryKey: ['doctor-home-clinic', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clinics').select('doctor_name').eq('id', clinicId).single()
      if (error) throw error
      return data as { doctor_name: string | null }
    },
  })
  const board = useQuery({
    queryKey: ['doctor-home-board', clinicId],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('visits').select('id, token_number, stage, arrived_at, patients(name)')
        .eq('clinic_id', clinicId).gte('arrived_at', startOfToday()).in('stage', ['waiting', 'called', 'ready_to_bill', 'paid']).order('arrived_at').limit(300)
      if (error) throw error
      return data as unknown as BoardVisit[]
    },
  })
  // Same keys and calls as the Reports screen, so the numbers agree and the cache is shared.
  const daily = useQuery({
    queryKey: ['report-daily'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_daily_report', {})
      if (error) throw error
      return data[0] as { collections_paise: number }
    },
  })
  const warnings = useQuery({
    queryKey: ['report-stock-warnings'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_stock_warnings_report', {})
      if (error) throw error
      return data as unknown[]
    },
  })
  const dueReview = useQuery({
    queryKey: ['doctor-home-due-review', clinicId],
    queryFn: async () => {
      const { count, error } = await supabase.from('long_term_register').select('patient_id', { count: 'exact', head: true }).lte('next_review_due', clinicToday())
      if (error) throw error
      return count ?? 0
    },
  })

  const hour = Number(new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }))
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const name = clinic.data?.doctor_name?.trim()
  const who = name ? (/^dr\.?\s/i.test(name) ? name : `Dr. ${name}`) : ''
  const date = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })

  const visits = board.data ?? []
  const waiting = visits.filter(v => v.stage === 'waiting' || v.stage === 'called')
  const paying = visits.filter(v => v.stage === 'ready_to_bill')
  const done = visits.filter(v => v.stage === 'paid').reverse()
  const stock = warnings.data?.length ?? 0
  const due = dueReview.data ?? 0

  const columns: { key: string; title: string; tone: 'info' | 'warn' | 'ok'; rows: BoardVisit[]; empty: string }[] = [
    { key: 'waiting', title: 'Waiting', tone: 'info', rows: waiting, empty: 'No one is waiting. New patients appear here as soon as reception checks them in.' },
    { key: 'paying', title: 'At reception for payment', tone: 'warn', rows: paying, empty: 'Nobody is waiting to pay.' },
    { key: 'done', title: 'Done today', tone: 'ok', rows: done, empty: 'Finished visits will be listed here.' },
  ]
  const attention: { text: string; section: string; icon: IconName }[] = [
    ...(due > 0 ? [{ text: `${due} patient${due === 1 ? ' is' : 's are'} due for a review`, section: 'register', icon: 'user' as IconName }] : []),
    ...(stock > 0 ? [{ text: `${stock} medicine${stock === 1 ? '' : 's'} running low or expiring`, section: 'stock', icon: 'box' as IconName }] : []),
  ]

  return (
    <section className="dhome" aria-label="Today at the clinic">
      <header className="dhome-head">
        <p className="dhome-date">{date}</p>
        <h2>{greeting}{who ? `, ${who}` : ''}</h2>
      </header>

      <dl className="dhome-numbers">
        <div><dd>{board.data ? waiting.length : '—'}</dd><dt>Waiting now</dt></div>
        <div><dd>{board.data ? done.length + paying.length : '—'}</dd><dt>Seen today</dt></div>
        <div><dd>{daily.data ? formatPaise(daily.data.collections_paise) : '—'}</dd><dt>Collected today</dt></div>
      </dl>

      <div className="dhome-board">
        {columns.map(col => (
          <section key={col.key} className={`dhome-col dhome-col-${col.tone}`} aria-label={col.title}>
            <h3>{col.title}<span>{board.data ? col.rows.length : '—'}</span></h3>
            {col.key === 'waiting' && col.rows.length > 0 && <Button className="dhome-call" variant="dark" disabled={busy} onClick={onCallNext}><Icon name="arrow" size={14} />Call #{col.rows[0].token_number}</Button>}
            {col.rows.length === 0 ? <p className="dhome-empty">{col.empty}</p> : <ul>
              {col.rows.slice(0, SHOWN).map(v => (
                <li key={v.id}>
                  <span className="dhome-token">#{v.token_number}</span>
                  <span className="dhome-name">{v.patients?.name}</span>
                  {col.key === 'waiting' && <StatusPill tone={elapsedMinutes(v.arrived_at) >= 45 ? 'warn' : 'info'}>{formatElapsed(v.arrived_at)}</StatusPill>}
                </li>
              ))}
              {col.rows.length > SHOWN && <li className="dhome-more">+ {col.rows.length - SHOWN} more</li>}
            </ul>}
          </section>
        ))}
      </div>

      <div className="dhome-attention">
        <h3>Needs your attention</h3>
        {attention.length === 0 && earlierOpen === 0 ? <p className="dhome-empty"><span className="dhome-ok" aria-hidden="true">✓</span> Nothing needs attention right now.</p> : <ul>
          {attention.map(a => <li key={a.section}><button type="button" onClick={() => onNavigate(a.section)}><Icon name={a.icon} size={16} />{a.text}<Icon name="arrow" size={14} /></button></li>)}
          {earlierOpen > 0 && <li className="dhome-note"><Icon name="alert" size={16} />{earlierOpen} visit{earlierOpen === 1 ? ' is' : 's are'} still open from earlier days. Reception can close {earlierOpen === 1 ? 'it' : 'them'} under Earlier days.</li>}
        </ul>}
      </div>

      <div className="dhome-links">
        <button type="button" onClick={() => document.querySelector<HTMLInputElement>('.shell-search-input')?.focus()}>Find a patient or medicine <kbd>/</kbd></button>
        <button type="button" onClick={() => onNavigate('patients')}>All patients</button>
        <button type="button" onClick={() => onNavigate('reports')}>Reports</button>
      </div>
    </section>
  )
}
