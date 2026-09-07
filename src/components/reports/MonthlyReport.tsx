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
  )
}
