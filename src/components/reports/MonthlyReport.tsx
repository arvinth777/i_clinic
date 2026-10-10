import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatPaise } from '../../lib/money'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'

type MonthRow = { month_start: string; collections_paise: number; patient_count: number; discount_paise: number }

function formatMonth(monthStart: string): string {
  const [y, m] = monthStart.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function MonthlyReport() {
  const { data: months, error } = useQuery({
    queryKey: ['report-monthly'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_monthly_report', { p_months: 6 })
      if (error) throw error
      return data as MonthRow[]
    },
  })

  if (error) return <p className="form-error">Couldn't load the monthly report.</p>
  if (!months) return <p className="readout-empty">Loading…</p>

  const max = Math.max(1, ...months.map(m => m.collections_paise))
  return <>
    <h2 className="readout-heading">Collections · last six months</h2>
    <div className="collections-chart" aria-label="Monthly collections chart">{months.map(m => <div className="collections-column" key={m.month_start}><span>{formatPaise(m.collections_paise)}</span><div className="collections-track"><div className="collections-bar" style={{ height: `${Math.max(0, m.collections_paise) / max * 100}%` }} /></div><small>{formatMonth(m.month_start)}</small></div>)}</div>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Month</TableHead>
          <TableHead>Collections</TableHead>
          <TableHead>Patients</TableHead>
          <TableHead>Discounts (subsidised care)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[...months].reverse().map((m) => (
          <TableRow key={m.month_start}>
            <TableCell className="font-medium">{formatMonth(m.month_start)}</TableCell>
            <TableCell className="font-mono tabular-nums">{formatPaise(m.collections_paise)}</TableCell>
            <TableCell className="font-mono tabular-nums">{m.patient_count}</TableCell>
            <TableCell className="font-mono tabular-nums">{formatPaise(m.discount_paise)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </>
}
