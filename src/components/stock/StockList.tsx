import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Drawer } from '../Drawer'
import { RecordPurchaseForm } from './RecordPurchaseForm'
import { TransferForm } from './TransferForm'
import { MonthlyCountForm } from './MonthlyCountForm'
import { AdjustStockForm } from './AdjustStockForm'

type Medicine = { id: string; name: string; low_stock_threshold: number | null }
type StockPoint = { id: string; name: string }
type StockRow = { medicine_id: string; stock_point_id: string; quantity: number }

export const stockQueryKey = (clinicId: string) => ['stock', clinicId]

type ActionKey = 'purchase' | 'transfer' | 'count' | 'adjust' | null

export function StockList({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = stockQueryKey(clinicId)
  const [action, setAction] = useState<ActionKey>(null)

  const { data: medicines } = useQuery({
    queryKey: ['medicines-for-stock', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from('medicines').select('id, name, low_stock_threshold').eq('clinic_id', clinicId).order('name')
      if (error) throw error
      return data as Medicine[]
    },
  })

  const { data: stockPoints } = useQuery({
    queryKey: ['stock-points', clinicId],
    queryFn: async () => {
      const { data, error } = await supabase.from('stock_points').select('id, name').eq('clinic_id', clinicId).order('name')
      if (error) throw error
      return data as StockPoint[]
    },
  })

  const { data: stockRows } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('medicine_stock').select('medicine_id, stock_point_id, quantity').eq('clinic_id', clinicId)
      if (error) throw error
      return data as StockRow[]
    },
  })

  function closeAction() {
    setAction(null)
  }
  function onActionDone() {
    queryClient.invalidateQueries({ queryKey })
    setAction(null)
  }

  function quantityAt(medicineId: string, stockPointId: string): number {
    return stockRows?.find((r) => r.medicine_id === medicineId && r.stock_point_id === stockPointId)?.quantity ?? 0
  }

  return (
    <div>
      <div className="admin-toolbar">
        <h2 className="readout-heading">Stock</h2>
        <div className="action-row">
          <button type="button" className="secondary-button" onClick={() => setAction('adjust')}>
            Adjust
          </button>
          <button type="button" className="secondary-button" onClick={() => setAction('count')}>
            Monthly count
          </button>
          <button type="button" className="secondary-button" onClick={() => setAction('transfer')}>
            Transfer
          </button>
          <button type="button" className="primary-button" onClick={() => setAction('purchase')}>
            + Record purchase
          </button>
        </div>
      </div>

      <div className="worklist-scroll">
        <table className="worklist">
          <thead>
            <tr>
              <th>Medicine</th>
              {(stockPoints ?? []).map((sp) => (
                <th key={sp.id}>{sp.name}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {(medicines ?? []).map((m) => {
              const total = (stockPoints ?? []).reduce((sum, sp) => sum + quantityAt(m.id, sp.id), 0)
              const isLow = m.low_stock_threshold != null && total <= m.low_stock_threshold
              return (
                <tr key={m.id} className="worklist-row">
                  <td className="worklist-name-cell">
                    {m.name}
                    {isLow && <span className="stock-badge">Low stock</span>}
                  </td>
                  {(stockPoints ?? []).map((sp) => {
                    const qty = quantityAt(m.id, sp.id)
                    return (
                      <td key={sp.id} className={`worklist-wait-cell ${qty < 0 ? 'stock-qty-negative' : ''}`}>
                        {qty}
                      </td>
                    )
                  })}
                  <td className={`worklist-wait-cell ${total < 0 ? 'stock-qty-negative' : isLow ? 'stock-qty-low' : ''}`}>{total}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Drawer open={action === 'purchase'} onClose={closeAction} title="Record purchase">
        {action === 'purchase' && (
          <RecordPurchaseForm clinicId={clinicId} medicines={medicines ?? []} stockPoints={stockPoints ?? []} onDone={onActionDone} onCancel={closeAction} />
        )}
      </Drawer>
      <Drawer open={action === 'transfer'} onClose={closeAction} title="Transfer stock">
        {action === 'transfer' && (
          <TransferForm clinicId={clinicId} medicines={medicines ?? []} stockPoints={stockPoints ?? []} onDone={onActionDone} onCancel={closeAction} />
        )}
      </Drawer>
      <Drawer open={action === 'count'} onClose={closeAction} title="Monthly count">
        {action === 'count' && (
          <MonthlyCountForm clinicId={clinicId} medicines={medicines ?? []} stockPoints={stockPoints ?? []} onDone={onActionDone} onCancel={closeAction} />
        )}
      </Drawer>
      <Drawer open={action === 'adjust'} onClose={closeAction} title="Adjust stock">
        {action === 'adjust' && (
          <AdjustStockForm clinicId={clinicId} medicines={medicines ?? []} stockPoints={stockPoints ?? []} onDone={onActionDone} onCancel={closeAction} />
        )}
      </Drawer>
    </div>
  )
}
