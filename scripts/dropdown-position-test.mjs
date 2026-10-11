// Live browser test for the drawer-dropdown CSS bug (docs/STATUS.md's
// High finding): `.search-results` (position: absolute) needs a
// positioned ancestor, but `.field`/`.record-section` never declared
// `position: relative` -- inside the consultation drawer (position:
// fixed), the dropdown anchored to the drawer itself instead of its own
// wrapper, landing one row below the visible viewport every time.
//
// Rendered checks, not a code reading, per this fix's own instruction:
// real getBoundingClientRect() measurements (matching how the original
// audit actually found this) plus a real mouse click at the dropdown's
// own on-screen coordinates -- a click dispatched by coordinate, not
// el.click(), since a coordinate click is what actually fails when the
// element is genuinely outside the viewport.
//
// Covers all three confirmed-broken drawer instances (prescription
// templates, drug search, procedures) plus MergePatients.tsx, which the
// original audit flagged as carrying the identical missing-
// position:relative pattern but left "severity unconfirmed" since it
// isn't rendered inside a fixed-position ancestor.
//
// Run from the project root: node scripts/dropdown-position-test.mjs

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import ws from 'ws'

function loadEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    out[t.slice(0, eq)] = t.slice(eq + 1)
  }
  return out
}
const appEnv = loadEnv('.env.local')
const userEnv = loadEnv('.env.test-users.local')
const CLINIC_A_ID = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'

const results = []
function report(label, pass, detail) {
  results.push({ label, pass })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ' -- ' + detail : ''}`)
}

async function signIn(email, password) {
  const client = createClient(appEnv.VITE_SUPABASE_URL, appEnv.VITE_SUPABASE_ANON_KEY, { realtime: { transport: ws } })
  await client.auth.signInWithPassword({ email, password })
  return client
}
const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)

// Clean up any stray with_doctor visits from earlier runs first -- the
// same fixture-collision lesson from Phase F's own testing: Consultation
// resolves "current" to whichever visit is first at with_doctor, not
// whichever row was clicked.
await doctorA.from('visits').update({ stage: 'packing' }).eq('clinic_id', CLINIC_A_ID).eq('stage', 'with_doctor')

const stamp = Date.now() + Math.random()
const { data: patient } = await doctorA.from('patients').insert({ clinic_id: CLINIC_A_ID, name: `Dropdown Position Test ${stamp}`, age: 31 }).select('id').single()
const { data: visit } = await doctorA.from('visits').insert({ clinic_id: CLINIC_A_ID, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint: 'dropdown position test' }).select('id').single()
await doctorA.from('visits').update({ stage: 'with_doctor' }).eq('id', visit.id)

// Clean up this script's own templates from earlier runs first -- left
// unbounded, they accumulate (prescription_template_items cascades on
// delete, per docs/STATUS.md), and templates render alphabetically by
// name: a growing pile of "Dropdown Test Template <timestamp>" rows
// pushes each new run's own fixture further down the list, which
// reproduced as a real, worsening flake (the same class of mistake the
// Procedures check below already had to correct for) before this cleanup
// was added, not assumed.
await doctorA.from('prescription_templates').delete().eq('clinic_id', CLINIC_A_ID).like('name', 'Dropdown Test Template%')

// A template guarantees the Templates dropdown actually has something to
// render, rather than depending on whatever templates staging happens to
// already have.
const { data: template } = await doctorA.from('prescription_templates').insert({ clinic_id: CLINIC_A_ID, name: `Dropdown Test Template ${stamp}` }).select('id').single()
const { data: medicine } = await doctorA.from('medicines').select('id').eq('clinic_id', CLINIC_A_ID).limit(1).single()
await doctorA.from('prescription_template_items').insert({
  clinic_id: CLINIC_A_ID,
  template_id: template.id,
  medicine_id: medicine.id,
  drug_type: 'Tablet',
  strength: '250mg',
  before_after_food: 'After food',
  dosage_frequency: '1-0-1',
  duration_days: 3,
})
console.log(`fixture: visit ${visit.id} at with_doctor, template ${template.id}`)

// Measures whether an element (matched by text or selector) is actually
// within the visible viewport, and separately whether a real mouse click
// dispatched at its own on-screen coordinates lands on it (vs. on
// whatever's actually there instead -- the drawer's own scrim, or
// nothing clickable at all).
async function checkDropdownReachable(page, itemLocator) {
  const box = await itemLocator.boundingBox()
  if (!box) return { withinViewport: false, coordClickHitsItem: false, box: null }
  const viewport = page.viewportSize()
  const withinViewport = box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width
  const centerX = box.x + box.width / 2
  const centerY = box.y + box.height / 2
  const hitElementHandle = await page.evaluateHandle(({ x, y }) => document.elementFromPoint(x, y), { x: centerX, y: centerY })
  const coordClickHitsItem = await page.evaluate(
    ([hitEl, itemEl]) => !!hitEl && (hitEl === itemEl || itemEl.contains(hitEl)),
    [hitElementHandle, await itemLocator.elementHandle()],
  )
  return { withinViewport, coordClickHitsItem, box }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

await page.goto('http://localhost:5173')
await page.locator('#signin-email').fill('doctor.a@staging.test')
await page.locator('#signin-password').fill(userEnv.TEST_DOCTOR_A_PASSWORD)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForSelector('.shell-nav', { timeout: 10000 })
await page.getByRole('button', { name: 'Consultation' }).click()
await page.waitForTimeout(500)

await page.locator('.worklist-row', { hasText: `Dropdown Position Test ${stamp}` }).click()
await page.waitForSelector('.drawer-panel', { timeout: 10000 })
// The drawer's own entrance transition (Drawer.tsx: 220ms) is still
// moving right after the panel attaches -- a coordinate-based hit test
// taken mid-transition can miss even though getBoundingClientRect()
// already reports the final, settled position (caught as a real,
// reproducible flake before adding this wait, not assumed).
await page.waitForTimeout(400)

// ---- Templates dropdown ----
// .first(), not matched by this run's own stamp text -- templates render
// alphabetically by name (not by recency, unlike MergePatients' search
// below), so *which* row is "first" depends on every other template
// name already in staging, not just this script's own fixture. What
// this check actually verifies -- the dropdown wrapper itself is
// correctly anchored -- holds regardless of which specific template
// happens to render first.
const templateItem = page.locator('.field.search-results-anchor .search-result-button').first()
await templateItem.waitFor({ state: 'attached', timeout: 5000 })
const templateCheck = await checkDropdownReachable(page, templateItem)
report('Templates dropdown is within the viewport', templateCheck.withinViewport, JSON.stringify(templateCheck.box))
report('Templates dropdown: a real coordinate click actually lands on it', templateCheck.coordClickHitsItem)

// ---- Drug search dropdown ----
await page.locator('#drug-search').fill('a') // any single common letter -- broad match across the medicines list
await page.waitForTimeout(500)
const drugResult = page.locator('.search-results .search-result-button').first()
if ((await drugResult.count()) > 0) {
  const drugCheck = await checkDropdownReachable(page, drugResult)
  report('Drug search dropdown is within the viewport', drugCheck.withinViewport, JSON.stringify(drugCheck.box))
  report('Drug search dropdown: a real coordinate click actually lands on it', drugCheck.coordClickHitsItem)
} else {
  report('Drug search dropdown is within the viewport', false, 'no search results rendered at all to check')
  report('Drug search dropdown: a real coordinate click actually lands on it', false, 'no search results rendered at all to check')
}

// ---- Procedures dropdown (PricingPanel, same drawer) ----
// .first(), not .last() -- staging has accumulated 100+ test procedures
// from earlier phases, so the *last* row of that long list is naturally
// far down the page on its own (a real, expected scroll, not the bug).
// What the CSS fix actually promises is that the dropdown itself opens
// anchored right below the "Procedures" heading -- checked via the first
// row, scoped to this section specifically since Templates/drug-search
// results may still be in the DOM alongside it.
const procedureItem = page
  .locator('section', { has: page.getByRole('heading', { name: 'Procedures' }) })
  .locator('.search-result-button')
  .first()
await procedureItem.waitFor({ state: 'attached', timeout: 5000 })
const procedureCheck = await checkDropdownReachable(page, procedureItem)
report('Procedures dropdown is within the viewport', procedureCheck.withinViewport, JSON.stringify(procedureCheck.box))
report('Procedures dropdown: a real coordinate click actually lands on it', procedureCheck.coordClickHitsItem)

// ---- MergePatients (standalone page, not inside a fixed drawer -- the audit's "unconfirmed" instance) ----
await page.locator('.drawer-close').click()
await page.getByRole('button', { name: 'Merge patients' }).click()
await page.waitForTimeout(500)
await page.locator('input[placeholder="Search by name or phone"]').first().fill('Dropdown Position Test')
await page.waitForTimeout(700)
const mergeResult = page.locator('.search-result-button', { hasText: `Dropdown Position Test ${stamp}` })
if ((await mergeResult.count()) > 0) {
  const mergeCheck = await checkDropdownReachable(page, mergeResult)
  report('MergePatients dropdown is within the viewport', mergeCheck.withinViewport, JSON.stringify(mergeCheck.box))
  report('MergePatients dropdown: a real coordinate click actually lands on it', mergeCheck.coordClickHitsItem)
} else {
  report('MergePatients dropdown is within the viewport', false, 'no search results rendered at all to check')
  report('MergePatients dropdown: a real coordinate click actually lands on it', false, 'no search results rendered at all to check')
}

await browser.close()

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
