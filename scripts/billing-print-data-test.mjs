// Render reception billing from persisted API reads; no browser/network emulation.
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createServer } from 'vite'
import WebSocket from 'ws'

globalThis.WebSocket ??= WebSocket

const server = await createServer({ server: { middlewareMode: true } })
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
try {
  const { Billing } = await server.ssrLoadModule('/src/components/Billing.tsx')
  const visitId = 'synthetic-print-visit'
  const clinicId = 'synthetic-print-clinic'
  client.setQueryData(['billing-visit', visitId], { id: visitId, token_number: 1, stage: 'paid', arrived_at: '2026-10-10', patients: { name: 'Synthetic print patient' } })
  client.setQueryData(['billing-pricing', visitId], { calculated_total_paise: 30000, final_amount_paise: 30000, discount_paise: 0, revision_number: 1, final_amount_set: true })
  client.setQueryData(['clinic-print-info', clinicId], { name: 'Synthetic clinic' })
  client.setQueryData(['paid-bill', visitId], { id: 'synthetic-bill', final_amount_paise: 30000, payment_method: 'cash', confirmed_at: '2026-10-10' })
  const detail = { kind: 'medicine', description: 'Synthetic tablets', unit_price_paise: 1000, quantity: 5, line_total_paise: 5000, stock_unit: 'tablet', dosage_frequency: '1-0-0', duration_days: 5 }
  const render = () => renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(Billing, { clinicId, visitId, onClose() {} })))
  client.setQueryData(['billing-detail', visitId], [{ ...detail, diagnosis: 'Saved diagnosis', advice: 'Saved advice <not HTML>' }])
  const complete = render()
  assert.match(complete, /Saved diagnosis/)
  assert.match(complete, /Saved advice &lt;not HTML&gt;/)
  assert.doesNotMatch(complete, /disabled=""[^>]*>Print again</)
  client.setQueryData(['billing-detail', visitId], [detail])
  const incomplete = render()
  assert.match(incomplete, /disabled=""[^>]*>Print again</, 'old cached rows cannot silently omit clinical notes')
  assert.match(incomplete, /Prescription instructions are not available on this device/)
  console.log('PASS: reception renders and escapes saved clinical notes; incomplete legacy print cache cannot produce a silent partial prescription')
} finally {
  client.clear()
  await server.close()
}
