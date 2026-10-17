// Pure-logic test for src/lib/clinicLearning.ts (suggestions learned from the clinic's prescribing history). No database.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import ts from 'typescript'
const load = async path => { const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }); return import('data:text/javascript;base64,' + Buffer.from(outputText.replace(/^import type .*$/mg, '')).toString('base64')) }
const { learn, matchingDiagnoses, medicinesForDiagnosis, applyDefaults, sortByPopularity, topMedicines, adviceSuggestions, topValues, EMPTY_LEARNING } = await load('../src/lib/clinicLearning.ts')
const item = (rx, medicine, over = {}) => ({ medicine_id: medicine, drug_type: 'Tablet', strength: '500 mg', before_after_food: 'After food', dosage_frequency: '1-0-1', duration_days: 5, prescription_id: rx, medicines: { name: `Med ${medicine}`, molecule_name: null }, prescriptions: { diagnosis: 'Lumbar spondylosis', advice: 'Avoid lifting heavy weights\nHot compress twice a day' }, ...over })
// newest first: the latest paracetamol was 1-1-1 for 3 days, the older two were 1-0-1 for 5 days
const history = [
  item('r1', 'pcm', { dosage_frequency: '1-1-1', duration_days: 3 }), item('r1', 'pgb', { prescriptions: { diagnosis: 'Lumbar spondylosis', advice: 'Avoid lifting heavy weights' } }),
  item('r2', 'pcm'), item('r2', 'pgb'), item('r3', 'pcm', { prescriptions: { diagnosis: 'lumbar  spondylosis', advice: null } }),
  item('r4', 'dcf', { prescriptions: { diagnosis: 'Frozen shoulder', advice: null }, strength: '50 mg', before_after_food: 'Before food' }),
]
const l = learn(history)
assert.equal(l.defaults.get('pcm').dosageFrequency, '1-0-1', 'the most common dose wins over the latest one')
assert.equal(l.defaults.get('pcm').durationDays, '5')
assert.equal(l.defaults.get('dcf').beforeAfterFood, 'Before food')
assert.equal(l.popularity.get('pcm'), 3); assert.equal(l.popularity.get('dcf'), 1)
assert.deepEqual(l.diagnoses.map(d => [d.text, d.count]), [['Lumbar spondylosis', 3], ['Frozen shoulder', 1]], 'diagnoses merge case and spacing, most used first')
assert.deepEqual(matchingDiagnoses(l, 'lum'), ['Lumbar spondylosis']); assert.deepEqual(matchingDiagnoses(l, 'Lumbar spondylosis'), [], 'an exact match is not offered back')
assert.deepEqual(matchingDiagnoses(l, ''), ['Lumbar spondylosis', 'Frozen shoulder'])
assert.deepEqual(medicinesForDiagnosis(l, ' LUMBAR spondylosis ').map(m => m.id), ['pcm', 'pgb'], 'medicines usually prescribed for the diagnosis')
assert.deepEqual(medicinesForDiagnosis(l, 'unknown'), [])
assert.deepEqual(l.advice.map(a => a.text).slice(0, 2), ['Avoid lifting heavy weights', 'Hot compress twice a day'])
const blank = { key: 'k', medicineId: 'pcm', medicineName: 'Med', drugType: 'Tablet', stockUnit: 'tablet', strength: '', beforeAfterFood: 'After food', dosageFrequency: '', durationDays: '', quantityDispensed: '', notes: '' }
const filled = applyDefaults(blank, l.defaults.get('pcm'))
assert.deepEqual([filled.strength, filled.dosageFrequency, filled.durationDays], ['500 mg', '1-0-1', '5'])
assert.equal(applyDefaults({ ...blank, dosageFrequency: 'SOS' }, l.defaults.get('pcm')).dosageFrequency, 'SOS', 'what the doctor already typed is never overwritten')
assert.deepEqual(applyDefaults(blank, undefined), blank, 'no history, no change')
assert.deepEqual(sortByPopularity([{ id: 'dcf' }, { id: 'new' }, { id: 'pcm' }], l).map(r => r.id), ['pcm', 'dcf', 'new'])
assert.deepEqual(topMedicines(l, new Set(['pcm'])).map(m => m.id), ['pgb', 'dcf'], 'often-prescribed medicines skip what is already on the prescription')
assert.deepEqual(adviceSuggestions(l, 'Avoid lifting heavy weights'), ['Hot compress twice a day'], 'advice already written is not offered again')
assert.deepEqual(topValues(['Back pain', 'back  pain', 'Knee pain', null, 'ok', 'Back pain', 'Knee pain', 'Neck pain']), ['Back pain', 'Knee pain', 'Neck pain'], 'most typed first; case, spacing and too-short values ignored')
assert.equal(learn([]).diagnoses.length, 0); assert.equal(EMPTY_LEARNING.advice.length, 0)
console.log('PASS: clinic learning (defaults, popularity, diagnoses, diagnosis medicines, advice)')
