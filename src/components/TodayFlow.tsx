import { elapsedMinutes } from '../lib/date'

// A wait past this is flagged in the overdue colour (danger), not just
// shown as a plain elapsed time -- reserving colour for something that
// actually needs attention, not decoration.
const LONG_WAIT_MINUTES = 30

export type TodayVisit = { stage: string; arrived_at: string }

// Today's flow: three real numbers off the clinic's own visits (nothing
// fabricated) plus one proportional bar in the same stage colours used
// everywhere else in the app -- waiting/with-doctor/seen-today, not the
// full five-stage taxonomy, since only these three matter from the
// doctor's own desk. A slim strip above the worklist, not a boxed card --
// nothing here needs its own visual region separate from the table below.
export function TodayFlow({ visits }: { visits: TodayVisit[] | undefined }) {
  const waiting = visits?.filter((v) => v.stage === 'waiting').length ?? 0
  const withDoctor = visits?.filter((v) => v.stage === 'with_doctor').length ?? 0
  const seenToday = visits?.filter((v) => v.stage !== 'waiting' && v.stage !== 'with_doctor').length ?? 0
  const total = waiting + withDoctor + seenToday

  const waitingMinutes = (visits ?? []).filter((v) => v.stage === 'waiting').map((v) => elapsedMinutes(v.arrived_at))
  const avgWait = waitingMinutes.length ? Math.round(waitingMinutes.reduce((sum, m) => sum + m, 0) / waitingMinutes.length) : null
  const overdue = avgWait !== null && avgWait >= LONG_WAIT_MINUTES

  return (
    <div className="flow-widget">
      <div className="flow-stats">
        <div className="flow-stat">
          <span className="flow-stat-value">{waiting}</span>
          <span className="flow-stat-label">Waiting</span>
        </div>
        <div className="flow-stat">
          <span className="flow-stat-value">{seenToday}</span>
          <span className="flow-stat-label">Seen today</span>
        </div>
        <div className="flow-stat">
          <span className={overdue ? 'flow-stat-value flow-overdue' : 'flow-stat-value'}>{avgWait !== null ? `${avgWait}m` : '—'}</span>
          <span className="flow-stat-label">Avg wait now</span>
        </div>
      </div>
      {total > 0 && (
        <div className="flow-bar" role="img" aria-label={`${waiting} waiting, ${withDoctor} with the doctor, ${seenToday} seen today`}>
          {waiting > 0 && <span className="flow-bar-segment flow-bar-waiting" style={{ flexGrow: waiting }} />}
          {withDoctor > 0 && <span className="flow-bar-segment flow-bar-with-doctor" style={{ flexGrow: withDoctor }} />}
          {seenToday > 0 && <span className="flow-bar-segment flow-bar-seen" style={{ flexGrow: seenToday }} />}
        </div>
      )}
    </div>
  )
}
