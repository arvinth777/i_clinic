import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatPaise } from '../../lib/money'

type MonthRow = { month_start: string; collections_paise: number; patient_count: number; discount_paise: number }

function formatMonth(monthStart: string): string {
  const [y, m] = monthStart.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function MonthlyReport() {
  const { data: months } = useQuery({
    queryKey: ['report-monthly'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_monthly_report', { p_months: 6 })
      if (error) throw error
      return data as MonthRow[]
    },
  })

  if (!months) return <p className="readout-empty">Loading…</p>

  return (
    <div className="worklist-scroll">
      <table className="worklist">
        <thead>
          <tr>
            <th>Month</th>
            <th>Collections</th>
            <th>Patients</th>
            <th>Discounts (subsidised care)</th>
          </tr>
        </thead>
        <tbody>
          {[...months].reverse().map((m) => (
            <tr key={m.month_start} className="worklist-row">
              <td className="worklist-name-cell">{formatMonth(m.month_start)}</td>
              <td className="worklist-wait-cell">{formatPaise(m.collections_paise)}</td>
              <td className="worklist-wait-cell">{m.patient_count}</td>
              <td className="worklist-wait-cell">{formatPaise(m.discount_paise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
