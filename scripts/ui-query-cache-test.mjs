// Render the actual paged screens against persisted caches from the previous UI.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as ReactQuery from '@tanstack/react-query'
const { QueryClient, QueryClientProvider } = ReactQuery
const require = createRequire(import.meta.url)
function screen(path) {
  const exports = {}
  const context = vm.createContext({ exports, require: name => {
    if (name === '@tanstack/react-query') return ReactQuery
    if (name.endsWith('/supabase')) return { supabase: {} }
    if (name.endsWith('/date')) return { startOfToday: () => '2026-10-10', formatDate: String, formatDateOnly: String }
    if (name.endsWith('/Billing')) return { Billing: () => null }
    if (name.endsWith('/ui/input')) return { Input: props => React.createElement('input', props) }
    if (name.endsWith('/ui/button')) return { Button: props => React.createElement('button', props) }
    return require(name)
  } })
  vm.runInContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context)
  return exports
}
const { Patients } = screen('src/pages/Patients.tsx')
const { BillingDesk } = screen('src/pages/BillingDesk.tsx')
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const records = Array.from({ length: 75 }, (_, i) => ({ id: String(i), name: `Synthetic patient ${i}`, age: 40, gender: null, phone: null, address: null }))
client.setQueryData(['patient-directory', 'synthetic-clinic', ''], records)
client.setQueryData(['billing-desk', 'synthetic-clinic'], records.map((p, i) => ({ id: p.id, token_number: i + 1, patients: { name: p.name }, stage: 'paid' })))
for (const [Component, props] of [[Patients, { isDoctor: false, canBill: true }], [BillingDesk, { readOnly: true }]]) {
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(Component, { clinicId: 'synthetic-clinic', ...props })))
  assert.equal((html.match(/class="record-selector"/g) ?? []).length, 50, 'previous flat cache becomes one page of 50')
  assert.match(html, /Synthetic patient 49/)
  assert.doesNotMatch(html, /Synthetic patient 50/)
  assert.match(html, /Show more/)
}
client.clear()
console.log('PASS: patient and billing screens safely restore legacy flat caches as paged data')
