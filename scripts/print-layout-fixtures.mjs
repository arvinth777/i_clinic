// Render the actual production components with synthetic data for browser PDF checks.
import { readFileSync, existsSync, writeFileSync, mkdirSync, cpSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const require = createRequire(import.meta.url)
function load(path) {
  const exports = {}
  const context = vm.createContext({ exports, require: name => name.endsWith('.css') ? {} : name.startsWith('.') ? load(resolve(dirname(path), name + (existsSync(resolve(dirname(path), name + '.ts')) ? '.ts' : '.tsx'))) : require(name) })
  vm.runInContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context)
  return exports
}
const { PrintablePrescription, PrintableReceipt } = load(resolve('src/components/VisitPrintout.tsx'))
const directory = process.env.PRINT_FIXTURE_DIR ?? '/private/tmp/clinic-print-layout'
mkdirSync(directory, { recursive: true })
cpSync('dist/assets', directory + '/assets', { recursive: true })
cpSync('public/letterhead', directory + '/letterhead', { recursive: true })
const css = readdirSync('dist/assets').find(f => f.endsWith('.css'))
const clinic = { name: 'Salem Pain & Palliative Care Clinic', doctor_name: 'Dr. G. P. Kirupakaran', doctor_registration_number: 'Synthetic print check', address: 'Synthetic layout check — not a patient document', phone: null }
const visit = { id: 'synthetic', token_number: 12, arrived_at: '2026-10-10T10:00:00+05:30', complaint: 'Synthetic complaint for layout verification.', diagnosis: 'Synthetic diagnosis for layout verification.', advice: 'Synthetic advice: this document is for print alignment only.', follow_up_date: '2026-10-24', patients: { name: 'SYNTHETIC PRINT CHECK', age: 45, gender: 'Female' } }
for (const [name, count] of [['short', 1], ['typical', 5], ['long', 30], ['receipt', 0], ['combined', 30]]) {
  const medicines = Array.from({ length: count }, (_, i) => ({ kind: 'medicine', description: `Synthetic medicine ${i + 1}`, strength: 'test strength', drug_type: 'Tablet', dosage_frequency: '1-0-1', duration_days: 5, before_after_food: 'After food', notes: 'Synthetic instruction — not for clinical use.', unit_price_paise: 1000, quantity: 10, line_total_paise: 10000, stock_unit: 'tablet' }))
  const props = { clinic, visit, medicines }
  const receipt = React.createElement(PrintableReceipt, { clinic, visit, billable: [{ description: 'Consultation', quantity: 1, unit_price_paise: 25000, line_total_paise: 25000 }, { description: 'Synthetic tablets', stock_unit: 'tablet', quantity: 3, unit_price_paise: 1000, line_total_paise: 3000 }], amountPaise: 27000, discountPaise: 1000, bill: { id: 'synthetic', payment_method: 'cash', confirmed_at: '2026-10-10' } })
  const document = name === 'combined' ? React.createElement(React.Fragment, null, React.createElement(PrintablePrescription, props), receipt) : count ? React.createElement(PrintablePrescription, props) : receipt
  writeFileSync(`${directory}/${name}.html`, `<!doctype html><html><head><meta charset="utf-8"><title>${name} synthetic print check</title><link rel="stylesheet" href="/assets/${css}"></head><body><div class="print-area" style="display:block">${renderToStaticMarkup(document)}</div></body></html>`)
}
console.log('Five synthetic print fixtures rendered in ' + directory)
