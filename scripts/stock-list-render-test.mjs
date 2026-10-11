// Exercise expiry rendering with real components and a synthetic saved stock read.
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
  const { StockList } = await server.ssrLoadModule('/src/components/stock/StockList.tsx')
  const clinicId = 'synthetic-expiry-clinic'
  client.setQueryData(['medicines-for-stock', clinicId], [{ id: 'expired', name: 'Synthetic expired tablets', stock_unit: 'tablet', price_paise: 1000, unit_confirmed_at: '2026-10-10', low_stock_threshold: 5, expiry_date: '2000-01-01' }])
  client.setQueryData(['stock-points', clinicId], [{ id: 'store', name: 'Store' }, { id: 'counter', name: 'Counter' }])
  client.setQueryData(['stock', clinicId], [{ medicine_id: 'expired', stock_point_id: 'store', quantity: 10 }, { medicine_id: 'expired', stock_point_id: 'counter', quantity: -10 }])
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(StockList, { clinicId })))
  assert.match(html, />Expired</, 'expiry alert survives a negative count at another stock point')
  assert.match(html, /class="[^"]*stock-qty-negative[^"]*">[^<]+<p[^>]*>Expired</, 'expired stock uses the danger colour, not the approaching-expiry colour')
  console.log('PASS: positive expired stock remains visible in red when another stock point has a cancelling negative count')
} finally {
  client.clear()
  await server.close()
}
