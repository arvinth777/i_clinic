import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatPaise } from '../../lib/money'
import { localDateStr } from '../../lib/date'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

type Gst = { collections_paise: number; discount_paise: number; bill_count: number }

function startOfMonthStr(): string {
  const d = new Date()
  d.setDate(1)
  return localDateStr(d)
}
function todayStr(): string {
  return localDateStr(new Date())
}

export function GstReport() {
  const [startDate, setStartDate] = useState(startOfMonthStr())
  const [endDate, setEndDate] = useState(todayStr())

  const { data: gst, refetch, isFetching } = useQuery({
    queryKey: ['report-gst', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_gst_report', { p_start_date: startDate, p_end_date: endDate })
      if (error) throw error
      return data[0] as Gst
    },
  })

  // Plain browser download -- no library, no server round trip: the
  // export is built from the same totals already on screen.
  function exportCsv() {
    if (!gst) return
    const rows = [
      ['start_date', 'end_date', 'collections_paise', 'discount_paise', 'bill_count'],
      [startDate, endDate, String(gst.collections_paise), String(gst.discount_paise), String(gst.bill_count)],
    ]
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gst-summary-${startDate}-to-${endDate}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return (
    <div>
      <form
        className="action-row"
        onSubmit={(e) => {
          e.preventDefault()
          refetch()
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="gst-start">
            From
          </label>
          <Input id="gst-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="gst-end">
            To
          </label>
          <Input id="gst-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
        </div>
        <Button type="submit" variant="secondary" disabled={isFetching}>
          {isFetching ? 'Loading…' : 'Refresh'}
        </Button>
      </form>

      {gst && (
        <>
          <div className="flow-stats">
            <div className="flow-stat">
              <span className="flow-stat-value">{formatPaise(gst.collections_paise)}</span>
              <span className="flow-stat-label">Collections</span>
            </div>
            <div className="flow-stat">
              <span className="flow-stat-value">{formatPaise(gst.discount_paise)}</span>
              <span className="flow-stat-label">Discounts</span>
            </div>
            <div className="flow-stat">
              <span className="flow-stat-value">{gst.bill_count}</span>
              <span className="flow-stat-label">Bills</span>
            </div>
          </div>
          <div className="action-row">
            <Button type="button" onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
