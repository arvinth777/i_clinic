import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatPaise } from '../lib/money'
import { clinicToday, startOfToday } from '../lib/date'
import { Icon } from './Icon'
import './DoctorHome.css'

type BoardVisit = { id: string; token_number: number; stage: string; arrived_at: string; patients: { name: string } | null }
const SHOWN = 5

// What the doctor sees when nobody is in the consultation room: a briefing for the day. The numbers, two plain lists (who is at
// reception paying, who is done) and the things that need attention. Who is waiting, and the Call button, stay in the side panel.
export function DoctorHome({ clinicId, onNavigate }: { clinicId: string; onNavigate: (section: string) => void }) {
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
  const date = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })

  const visits = board.data ?? []
  const waiting = visits.filter(v => v.stage === 'waiting' || v.stage === 'called')
  const paying = visits.filter(v => v.stage === 'ready_to_bill')
  const done = visits.filter(v => v.stage === 'paid').reverse()
  const stock = warnings.data?.length ?? 0
  const due = dueReview.data ?? 0

  const columns: { key: string; title: string; tone: 'warn' | 'ok'; rows: BoardVisit[]; empty: string }[] = [
    { key: 'paying', title: 'At reception for payment', tone: 'warn', rows: paying, empty: 'Nobody is waiting to pay.' },
    { key: 'done', title: 'Done today', tone: 'ok', rows: done, empty: 'Finished visits will be listed here.' },
  ]
  const attention: { text: string; section: string }[] = [
    ...(due > 0 ? [{ text: `${due} patient${due === 1 ? '' : 's'} to review`, section: 'register' }] : []),
    ...(stock > 0 ? [{ text: `${stock} medicine${stock === 1 ? '' : 's'} to check`, section: 'stock' }] : []),
  ]
  const failed = board.isError || daily.isError
  const retry = () => { void board.refetch(); void daily.refetch(); void warnings.refetch(); void dueReview.refetch() }

  return (
    <section className="dhome" aria-label="Today at the clinic" aria-busy={!board.data && !failed}>
      <header className="dhome-head">
        <p className="dhome-date">{date}</p>
        <h2>{greeting}, Doctor</h2>
      </header>

      {failed && <p className="dhome-error" role="alert">Today's numbers could not be loaded. <button type="button" onClick={retry}>Try again</button></p>}

      <dl className="dhome-numbers">
        <div><dt>Waiting now</dt><dd>{board.data ? waiting.length : '—'}</dd></div>
        <div><dt>Seen today</dt><dd>{board.data ? done.length + paying.length : '—'}</dd></div>
        <div><dt>Collected today</dt><dd>{daily.data ? formatPaise(daily.data.collections_paise) : '—'}</dd></div>
      </dl>

      <div className="dhome-board">
        {columns.map(col => (
          <section key={col.key} className={`dhome-col dhome-col-${col.tone}`} aria-label={col.title}>
            <h3>{col.title}<em>{board.data ? col.rows.length : '—'}</em></h3>
            {!board.data && !failed ? <ul aria-hidden="true"><li className="dhome-skel" /><li className="dhome-skel" /></ul> : col.rows.length === 0 ? <p className="dhome-empty">{col.empty}</p> : <ul>
              {col.rows.slice(0, SHOWN).map(v => (
                <li key={v.id}><span className="dhome-token">#{v.token_number}</span><span className="dhome-name">{v.patients?.name}</span></li>
              ))}
              {col.rows.length > SHOWN && <li className="dhome-more">+ {col.rows.length - SHOWN} more</li>}
            </ul>}
          </section>
        ))}
      </div>

      <div className="dhome-attention">
        <h3>Needs your attention</h3>
        {attention.length === 0 ? <p className="dhome-empty"><span className="dhome-ok" aria-hidden="true">✓</span> Nothing needs attention right now.</p> : <ul>
          {attention.map(a => <li key={a.section}><button type="button" onClick={() => onNavigate(a.section)}>{a.text}<Icon name="arrow" size={14} /></button></li>)}
        </ul>}
      </div>

      <div className="dhome-links">
        <button type="button" onClick={() => onNavigate('patients')}>All patients</button>
        <button type="button" onClick={() => onNavigate('reports')}>Reports</button>
      </div>
    </section>
  )
}
