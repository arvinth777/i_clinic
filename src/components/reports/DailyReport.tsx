import { useState } from 'react'
import { LoadingRows } from '../QueryState'
import { Button } from '../ui/button'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatPaise } from '../../lib/money'

type Daily = {
  collections_paise: number
  patient_count: number
  discount_paise: number
  needs_reconciliation_count: number
  corrections_today_count: number
  corrections_today_net_paise: number
}
const WARNINGS_SHOWN = 10
type StockWarning = { medicine_name: string; total_quantity: number; low_stock_threshold: number | null }

export function DailyReport() {
  const [showAllWarnings, setShowAllWarnings] = useState(false)
  const { data: daily, error: dailyError } = useQuery({
    queryKey: ['report-daily'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_daily_report', {})
      if (error) throw error
      return data[0] as Daily
    },
  })

  const { data: warnings, error: warningsError } = useQuery({
    queryKey: ['report-stock-warnings'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_stock_warnings_report', {})
      if (error) throw error
      return data as StockWarning[]
    },
  })

  if (dailyError) return <p className="form-error">Couldn't load the daily report.</p>
  if (!daily) return <LoadingRows label="Loading…" />

  return (
    <div>
      <div className="flow-stats">
        <div className="flow-stat">
          <span className="flow-stat-value">{formatPaise(daily.collections_paise)}</span>
          <span className="flow-stat-label">Collections today</span>
        </div>
        <div className="flow-stat">
          <span className="flow-stat-value">{daily.patient_count}</span>
          <span className="flow-stat-label">Patients today</span>
        </div>
        <div className="flow-stat">
          <span className="flow-stat-value">{formatPaise(daily.discount_paise)}</span>
          <span className="flow-stat-label">Discounts given today</span>
        </div>
        <div className="flow-stat">
          <span className={daily.needs_reconciliation_count > 0 ? 'flow-stat-value flow-overdue' : 'flow-stat-value'}>{daily.needs_reconciliation_count}</span>
          <span className="flow-stat-label">Bills needing reconciliation</span>
        </div>
        <div className="flow-stat">
          <span className="flow-stat-value">{daily.corrections_today_count}</span>
          <span className="flow-stat-label">
            Corrections today
            {daily.corrections_today_count > 0 ? ` (${formatPaise(daily.corrections_today_net_paise)} net)` : ''}
          </span>
        </div>
      </div>
      {daily.corrections_today_count > 0 && (
        <p className="readout-empty report-note">
          Collections already include today's correction(s) at the corrected amount. A correction counts on the day it
          was entered, so some of today's collections may come from adjusting an earlier bill, not from a new visit today.
        </p>
      )}

      <section className="record-section">
        <h3 className="readout-heading">Stock warnings{warnings && warnings.length > 0 ? ` · ${warnings.length}` : ''}</h3>
        {warningsError ? <p className="form-error">Couldn't load stock warnings.</p> : !warnings ? <LoadingRows label="Loading stock warnings…" /> : warnings.length === 0 ? (
          <p className="readout-empty">No low or negative stock right now.</p>
        ) : (
          <ul className="past-visit-list">
            {warnings.slice(0, showAllWarnings ? warnings.length : WARNINGS_SHOWN).map((w) => (
              <li key={w.medicine_name} className="past-visit-item bill-item-row">
                <span>{w.medicine_name}</span>
                <span className={w.total_quantity < 0 ? 'pricing-value stock-qty-negative' : 'pricing-value'}>
                  {w.total_quantity}
                  {w.low_stock_threshold != null ? ` / threshold ${w.low_stock_threshold}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {warnings && warnings.length > WARNINGS_SHOWN && !showAllWarnings && <Button variant="secondary" onClick={() => setShowAllWarnings(true)}>Show all {warnings.length}</Button>}
      </section>
    </div>
  )
}
