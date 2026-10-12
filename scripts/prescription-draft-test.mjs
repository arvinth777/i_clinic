// Pure-logic test for src/lib/prescriptionDraft.ts's usualCombo (Phase
// UI-3) -- no DB, no framework, same "plain script, no framework"
// convention as every other scripts/*-test.mjs, just without a live
// staging dependency since this function touches neither Supabase nor
// React. Transpiles the single source file on the fly via the
// already-installed `typescript` package (no new dependency, no
// tsx/ts-node) rather than duplicating the logic here in plain JS, which
// would drift from the real implementation instead of testing it.
// Run from the project root: node scripts/prescription-draft-test.mjs

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/prescriptionDraft.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
})
const { usualCombo, newDraftItem, suggestedQuantity, itemIsValid } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))

let passed = 0
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name)
  passed++
  console.log(`ok - ${name}`)
}

function item(medicineId, name, strength) {
  return {
    medicine_id: medicineId,
    medicines: { name },
    drug_type: 'Tablet',
    strength,
    before_after_food: 'After food',
    dosage_frequency: '1-0-1',
    duration_days: 5,
    quantity_dispensed: 1,
    notes: null,
  }
}

function prescription(id, itemsList) {
  return { id, created_at: `2026-01-${id.padStart(2, '0')}`, prescription_items: itemsList }
}

// 1. Fewer than 2 past prescriptions -- never "usual," one data point
// isn't a pattern.
check('zero history', usualCombo([]), [])
check(
  'one prescription',
  usualCombo([prescription('01', [item('m1', 'Paracetamol', '500mg')])]),
  [],
)

// 2. Exactly 2 prescriptions, appears in both -- a majority of 2 (2 > 1).
check(
  'majority of 2',
  usualCombo([prescription('02', [item('m1', 'Paracetamol', '500mg')]), prescription('01', [item('m1', 'Paracetamol', '500mg')])]).map((c) => c.medicineId),
  ['m1'],
)

// 3. 5 prescriptions (newest first): m1 in 4/5 (majority), m2 in 2/5
// (not a majority, 2 is not > 2.5) -- m2 must be excluded.
const fiveNewestFirst = [
  prescription('05', [item('m1', 'Paracetamol', '250mg'), item('m2', 'Cough syrup', '10ml')]),
  prescription('04', [item('m1', 'Paracetamol', '500mg')]),
  prescription('03', [item('m1', 'Paracetamol', '500mg'), item('m2', 'Cough syrup', '10ml')]),
  prescription('02', [item('m1', 'Paracetamol', '500mg')]),
  prescription('01', []),
]
const combo5 = usualCombo(fiveNewestFirst)
check('majority of 5 -- only the majority drug included', combo5.map((c) => c.medicineId), ['m1'])
check('most-recent occurrence wins the fields, not an older one', combo5[0].item.strength, '250mg')

// 4. A 6th, older prescription is outside the last-5 window and must not
// count toward the majority.
const sixPrescriptions = [
  prescription('06', [item('m1', 'Paracetamol', '250mg')]),
  prescription('05', []),
  prescription('04', []),
  prescription('03', []),
  prescription('02', []),
  prescription('01', [item('m1', 'Paracetamol', '500mg')]), // outside the window -- ignored
]
check('only the last 5 prescriptions are ever considered', usualCombo(sixPrescriptions), [])

console.log(`\n${passed}/${passed} passed`)

const draft = { ...newDraftItem('m1', 'Synthetic tablet', 'tablet'), dosageFrequency: '1-0-1', durationDays: '5' }
check('twice daily for five days suggests ten tablets', suggestedQuantity(draft, 'tablet'), 10)
check('half tablet twice daily for five days suggests five tablets', suggestedQuantity({ ...draft, dosageFrequency: '0.5-0-0.5' }, 'tablet'), 5)
check('SOS has no inferred quantity', suggestedQuantity({ ...draft, dosageFrequency: 'SOS' }, 'tablet'), null)
check('bottle has no inferred quantity', suggestedQuantity(draft, 'bottle'), null)
check('strip has no inferred quantity', suggestedQuantity(draft, 'strip'), null)
check('non-whole supply needs explicit quantity', suggestedQuantity({ ...draft, dosageFrequency: '0.5-0-0', durationDays: '1' }, 'tablet'), null)
check('typed instructions have no inferred quantity', suggestedQuantity({ ...draft, dosageFrequency: 'every other day' }, 'tablet'), null)

// New-item defaults: no prefilled dose, type follows the stock unit, strength required for tablets/capsules.
check('dose is never prefilled', newDraftItem('m1', 'X').dosageFrequency, '')
check('stock unit picks the drug type', [newDraftItem('m', 'X', 'Capsules').drugType, newDraftItem('m', 'X', 'syrup').drugType, newDraftItem('m', 'X', 'strip').drugType], ['Capsule', 'Syrup', 'Tablet'])
const ready = { ...draft, strength: '500mg', quantityDispensed: '10' }
check('complete tablet is valid', itemIsValid(ready), true)
check('tablet without strength is invalid', itemIsValid({ ...ready, strength: ' ' }), false)
check('syrup without strength is valid', itemIsValid({ ...ready, drugType: 'Syrup', strength: '' }), true)
check('empty dose is invalid', itemIsValid({ ...ready, dosageFrequency: '' }), false)
