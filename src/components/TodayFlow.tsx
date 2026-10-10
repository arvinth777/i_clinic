export type TodayVisit = { stage: string; arrived_at: string }

export function TodayFlow({ visits }: { visits: TodayVisit[] | undefined }) {
  const waiting = visits?.filter(v => v.stage === 'waiting').length
  const seen = visits?.filter(v => ['packing', 'ready_at_reception', 'paid'].includes(v.stage)).length
  return <div className="flow-widget"><strong>Today · {waiting ?? '…'} waiting</strong><span>{seen ?? '…'} seen today</span></div>
}
