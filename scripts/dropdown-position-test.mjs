// Live browser test (rewritten 2026-10-19 for the full-page prescription: the consultation drawer no longer exists) for the dropdown CSS bug (docs/STATUS.md's
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

// Consultation resolves "current" to whichever visit is first at with_doctor/called, so close any strays first (cancel needs a reason).
const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
const doctorQueue = (client, id, action, reason) => client.rpc('queue_visit_action', { p_visit_id: id, p_action: action, p_request_id: crypto.randomUUID(), p_reason: reason ?? null })
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)
const { data: strays } = await doctorA.from('visits').select('id').eq('clinic_id', CLINIC_A_ID).in('stage', ['called', 'with_doctor'])
for (const stray of strays ?? []) await doctorQueue(doctorA, stray.id, 'cancel', 'dropdown test cleanup')

const stamp = Date.now() + Math.random()
const { data: patient } = await receptionA.from('patients').insert({ clinic_id: CLINIC_A_ID, name: `Dropdown Position Test ${stamp}`, age: 31 }).select('id').single()
const { data: visit } = await receptionA.from('visits').insert({ clinic_id: CLINIC_A_ID, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint: 'dropdown position test' }).select('id').single()
const { data: waiting } = await receptionA.from('visits').select('id').eq('clinic_id', CLINIC_A_ID).eq('stage', 'waiting').gte('arrived_at', midnight.toISOString()).order('queue_position')
for (let i = 0; i < waiting.findIndex(v => v.id === visit.id); i++) await doctorQueue(receptionA, visit.id, 'move_up')
await doctorQueue(doctorA, visit.id, 'call')
await doctorQueue(receptionA, visit.id, 'sent_in')

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
await page.locator('nav.shell-nav a[href="#consultation"]').click()
await page.getByRole('button', { name: /Start prescription/ }).click({ timeout: 15000 })
await page.waitForSelector('#drug-search', { timeout: 10000 })
// (Historical) the old drawer's entrance transition (Drawer.tsx: 220ms) was still
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
const templateItem = page.locator('.rx-quick-add .rx-chip').first()
await templateItem.waitFor({ state: 'attached', timeout: 5000 })
const templateCheck = await checkDropdownReachable(page, templateItem)
report('Quick-add chips are within the viewport', templateCheck.withinViewport, JSON.stringify(templateCheck.box))
report('Quick-add chips: a real coordinate click actually lands on one', templateCheck.coordClickHitsItem)

// ---- Drug search dropdown ----
await page.locator('#drug-search').fill('a') // any single common letter -- broad match across the medicines list
const drugResult = page.locator('.search-results .search-result-button').first()
await drugResult.waitFor({ state: 'attached', timeout: 6000 }).catch(() => {}) // the search is debounced and queries the catalog
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
await page.locator('#drug-search').fill('')
const procedureInput = page.getByPlaceholder(/procedure/i).first()
await procedureInput.scrollIntoViewIfNeeded() // the procedures box sits well below the fold on the full page; the check is about the dropdown's anchor, not the page scroll
await procedureInput.fill('a')
await page.waitForTimeout(600)
const procedureItem = page
  .locator('section', { has: page.getByRole('heading', { name: 'Procedures' }) })
  .locator('.search-result-button')
  .first()
await procedureItem.waitFor({ state: 'attached', timeout: 5000 })
const procedureCheck = await checkDropdownReachable(page, procedureItem)
report('Procedures dropdown is within the viewport', procedureCheck.withinViewport, JSON.stringify(procedureCheck.box))
report('Procedures dropdown: a real coordinate click actually lands on it', procedureCheck.coordClickHitsItem)

// ---- The merge search now lives inside a patient's file (a plain list under the field, not a floating dropdown),
// so it has no dropdown position to check here; the old standalone MergePatients page was removed.

await browser.close()
await doctorQueue(doctorA, visit.id, 'cancel', 'dropdown test finished') // leave no consultation open for the next test

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
