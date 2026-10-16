// Pure-logic test for src/lib/patientTimeline.ts (no DB, no framework): events from visits, prescriptions, bills and
// documents are merged newest first, payment vs pay-later vs settlement are told apart, and a date-only examination
// date never becomes a timestamp. Run from the project root: node scripts/patient-timeline-test.mjs
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import ts from 'typescript'
const source = readFileSync(new URL('../src/lib/patientTimeline.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } })
const { buildTimeline } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))

const visits = [{ id: 'v1', arrived_at: '2026-10-01T04:00:00Z', complaint: 'knee pain', token_number: 7 }, { id: 'v2', arrived_at: '2026-10-10T04:00:00Z', complaint: '', token_number: 3 }]
const prescriptions = [{ id: 'p1', visit_id: 'v1', created_at: '2026-10-01T04:30:00Z', diagnosis: 'OA knee' }]
const bills = [
  { id: 'b1', visit_id: 'v1', final_amount_paise: 50000, payment_method: 'upi', confirmed_at: '2026-10-01T05:00:00Z', corrects_bill_id: null, bill_settlements: null },
  { id: 'b2', visit_id: 'v2', final_amount_paise: 30000, payment_method: 'pay_later', confirmed_at: '2026-10-10T05:00:00Z', corrects_bill_id: null, bill_settlements: { payment_method: 'cash', settled_at: '2026-10-12T06:00:00Z' } },
  { id: 'b3', visit_id: 'v1', final_amount_paise: 45000, payment_method: 'cash', confirmed_at: '2026-10-02T05:00:00Z', corrects_bill_id: 'b1', bill_settlements: [] },
]
const files = [
  { id: 'f1', title: 'Spine MRI', category: 'MRI', examination_date: '2026-09-20', created_at: '2026-10-05T07:00:00Z', status: 'ready' },
  { id: 'f2', title: 'Half uploaded', category: 'Other', examination_date: null, created_at: '2026-10-06T07:00:00Z', status: 'uploading' },
]
const events = buildTimeline({ visits, prescriptions, bills, files })
const keys = events.map(e => e.key)
assert.deepEqual(keys, ['settle:b2', 'bill:b2', 'visit:v2', 'file:f1', 'bill:b3', 'bill:b1', 'rx:p1', 'visit:v1'], 'newest first')
assert.ok(!keys.includes('file:f2'), 'a file still uploading is not shown')
const by = Object.fromEntries(events.map(e => [e.key, e]))
assert.equal(by['bill:b1'].title, 'Payment received · UPI')
assert.equal(by['bill:b2'].title, 'Bill confirmed · pay later, not paid yet')
assert.equal(by['settle:b2'].title, 'Pay-later bill settled · cash')
assert.equal(by['bill:b3'].title, 'Bill correction · cash')
assert.equal(by['bill:b1'].amountPaise, 50000)
assert.equal(by['file:f1'].examinationDate, '2026-09-20')
assert.equal(by['file:f1'].at, '2026-10-05T07:00:00Z', 'the event time is the upload time, never the examination date')
assert.equal(by['visit:v2'].detail, undefined, 'an empty complaint gives no detail')
assert.equal(buildTimeline({ visits: [], prescriptions: [], bills: [], files: [] }).length, 0)
console.log('PASS: patient timeline')
