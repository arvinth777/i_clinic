import { useState } from 'react'
import { DailyReport } from '../components/reports/DailyReport'
import { MonthlyReport } from '../components/reports/MonthlyReport'
import { GstReport } from '../components/reports/GstReport'

const TABS = [
  { key: 'daily', label: 'Daily' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'gst', label: 'GST / tax' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function Reports() {
  const [tab, setTab] = useState<TabKey>('daily')

  return (
    <div className="admin-page">
      <nav className="admin-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={t.key === tab ? 'shell-nav-item active' : 'shell-nav-item'} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="admin-panel">
        {tab === 'daily' && <DailyReport />}
        {tab === 'monthly' && <MonthlyReport />}
        {tab === 'gst' && <GstReport />}
      </div>
    </div>
  )
}
