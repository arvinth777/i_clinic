import { useState } from 'react'
import { StockList } from '../components/stock/StockList'
import { Suppliers } from '../components/stock/Suppliers'
import './Stock.css'

const TABS = [
  { key: 'stock', label: 'Stock' },
  { key: 'suppliers', label: 'Suppliers' },
] as const

type TabKey = (typeof TABS)[number]['key']

export function Stock({ clinicId }: { clinicId: string }) {
  const [tab, setTab] = useState<TabKey>('stock')

  return (
    <div className="admin-page">
      <nav className="admin-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={t.key === tab ? 'shell-nav-item active' : 'shell-nav-item'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="admin-panel">
        {tab === 'stock' && <StockList clinicId={clinicId} />}
        {tab === 'suppliers' && <Suppliers clinicId={clinicId} />}
      </div>
    </div>
  )
}
