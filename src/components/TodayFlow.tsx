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
// doctor's own desk.
//
// Bento-grid tiles (user-directed reference: websiteprompts.com/design/
// bento-grid), the first application of that pattern in this app --
// varied but aligned tiles, one bold "hero" colour and two paler
// supporting tiles, each with one clear number. Colours here are new,
// standalone tile tokens (--tile-hero/--tile-mint/--tile-amber), not
// reused --accent/--success/--warning -- this widget is a categorical,
// at-a-glance summary, a different job from the stage semantics
// elsewhere in the app, and reusing --success here would have diluted
// its "only ever the paid-stamp" rule.
export function TodayFlow({ visits }: { visits: TodayVisit[] | undefined }) {
  const waiting = visits?.filter((v) => v.stage === 'waiting').length ?? 0
  const withDoctor = visits?.filter((v) => v.stage === 'with_doctor').length ?? 0
  const seenToday = visits?.filter((v) => v.stage !== 'waiting' && v.stage !== 'with_doctor').length ?? 0
  const total = waiting + withDoctor + seenToday

  // Replaces the old "average current wait" -- an average of live,
  // in-progress waits, not a completed-wait metric, and not something
  // the user found actually useful ("no it won't be useful," in
  // conversation). A straight count of who's currently waiting *past*
  // the threshold is the actionable version of the same underlying
  // data: not "what's the number," but "how many people am I making
  // wait too long, right now."
  const overdueCount = (visits ?? []).filter((v) => v.stage === 'waiting' && elapsedMinutes(v.arrived_at) >= LONG_WAIT_MINUTES).length

  return (
    <div className="flow-widget">
      <div className="flow-grid">
        <div className="flow-tile flow-tile-hero">
          <svg className="flow-tile-ring" width="160" height="160" viewBox="0 0 160 160" aria-hidden="true">
            <circle cx="80" cy="80" r="68" fill="none" stroke="currentColor" strokeWidth="18" opacity="0.35" />
          </svg>
          <span className="flow-tile-label">Waiting</span>
          <span className="flow-tile-value">{waiting}</span>
        </div>
        <div className="flow-tile flow-tile-mint">
          <span className="flow-tile-label">Seen today</span>
          <span className="flow-tile-value">{seenToday}</span>
        </div>
        <div className="flow-tile flow-tile-amber">
          <span className="flow-tile-label">Overdue (30m+)</span>
          <span className={overdueCount > 0 ? 'flow-tile-value flow-overdue' : 'flow-tile-value'}>{overdueCount}</span>
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
