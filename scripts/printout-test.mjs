// Render the canonical print DOM; current catalog prices must not rewrite a receipt.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const require = createRequire(import.meta.url)
function load(path, source = readFileSync(path, 'utf8')) {
  const exports = {}
  const context = vm.createContext({ exports, require: (name) => name.endsWith('.css') ? {} : name.startsWith('.') ? load(resolve(dirname(path), name + '.ts')) : require(name) })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, context)
  return exports
}
let source
if (process.argv.includes('--before-fix')) {
  const old = execFileSync('git', ['show', '2986888:src/components/Billing.tsx'], { encoding: 'utf8' })
  source = "import { formatPaise } from '../lib/money'; import { formatDate } from '../lib/date';\n" + old.slice(old.indexOf('type Visit ='), old.indexOf('const PAYMENT_METHODS')) + old.slice(old.indexOf('type ClinicPrintInfo ='), old.indexOf('export function Billing')) + '\nexport { PrintableSlip };'
}
const { PrintableSlip, PrintableReceipt } = load(resolve('src/components/VisitPrintout.tsx'), source)
const detail = [{ kind: 'medicine', description: 'Synthetic medicine', unit_price_paise: 900, duration_days: 5, dosage_frequency: '1-0-1', notes: null }]
const bill = { id: 'synthetic', final_amount_paise: 25100, payment_method: 'cash', confirmed_at: '2026-10-10', bill_line_items: [{ kind: 'consultation', description: 'Consultation', quantity: 1, unit_price_paise: 25000, line_total_paise: 25000 }, { kind: 'medicine', description: 'Synthetic medicine', quantity: 1, unit_price_paise: 100, line_total_paise: 100 }] }
const html = renderToStaticMarkup(React.createElement(PrintableSlip, { visit: { id: 'visit', token_number: 1, arrived_at: '2026-10-10', patients: { name: '<script>Synthetic</script>' } }, detail, amountPaise: 25100, discountPaise: 800, bill }))
assert.ok(html.includes('₹1.00') && !html.includes('₹9.00'), 'receipt must show the saved price, not the changed catalog price')
assert.ok(html.includes('₹0.00'), 'saved receipt discount must come from its frozen lines')
assert.ok(!html.includes('<script>'), 'patient text must be escaped')
const unknown = renderToStaticMarkup(React.createElement(PrintableSlip, { visit: { id: 'visit', token_number: 1, arrived_at: '2026-10-10', patients: { name: 'Synthetic' } }, detail: undefined, amountPaise: 25100, discountPaise: 0, bill }))
assert.ok(!unknown.includes('No medicines prescribed'), 'missing instructions must not be presented as an empty prescription')
console.log('PASS: saved receipt prices, discount, escaped text, and unknown instructions')
const { mergePrescriptionPrint } = load(resolve('src/lib/prescriptionPrint.ts'))
const earlier = { medicines: [{ prescription_id: 'older', description: 'Keep this medicine' }, { prescription_id: 'retry', description: 'Old instructions' }], prescriptionIds: ['older', 'retry'] }
const revised = { medicines: [{ prescription_id: 'retry', description: 'Corrected instructions' }], prescriptionIds: ['retry'] }
const merged = mergePrescriptionPrint(earlier, revised)
assert.equal(merged.medicines.length, 2)
assert.equal(merged.medicines[0].description, 'Keep this medicine')
assert.equal(merged.medicines[1].description, 'Corrected instructions')
assert.equal(mergePrescriptionPrint(merged, revised).medicines.length, 2, 'a repeated save cannot duplicate printable instructions')
console.log('PASS: retry replaces edited instructions without losing earlier medicines')

const pharmacy = renderToStaticMarkup(React.createElement(PrintableReceipt, { clinic: { name: 'Synthetic clinic' }, customerName: 'Synthetic pharmacy <customer>', billable: [{ kind: 'medicine', description: 'Synthetic tablets', quantity: 3, stock_unit: 'tablet', unit_price_paise: 1000, line_total_paise: 3000 }], amountPaise: 2500, discountPaise: 500, bill: { id: 'pending', final_amount_paise: 2500, payment_method: 'upi', confirmed_at: '2026-10-10', pending: true } }))
assert.ok(pharmacy.includes('₹30.00') && pharmacy.includes('₹25.00') && pharmacy.includes('× 3 tablet'))
assert.ok(pharmacy.includes('not saved yet') && pharmacy.includes('&lt;customer&gt;'))
assert.ok(!pharmacy.includes('Token') && !pharmacy.includes('Consultation') && !pharmacy.includes('Prescription'))
console.log('PASS: name-only pharmacy receipt shows quantity, unit, discount and pending state without clinical history')
