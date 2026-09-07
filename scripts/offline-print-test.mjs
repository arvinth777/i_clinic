// The offline print suite (docs/STATUS.md's Medium finding: a narrow
// timing gap in non-negotiable #7's "prints with zero connectivity"
// guarantee). Live Playwright script against the PRODUCTION build
// (`npm run build && vite preview` -- the service worker is disabled
// under `npm run dev`), same convention as every other offline-behaviour
// check in this repo.
//
// Root cause: Billing.tsx's `detail` query (get_visit_billing_detail --
// the prescription/procedure rows PrintableSlip renders) was a separate
// React Query from the one driving "Amount to collect", with nothing
// ensuring the former resolves before "Confirm payment" was clickable.
// If connectivity dropped in that exact window, print fired from
// `detail === undefined` -- an empty prescription table, not a warning.
//
// Two scenarios, both reproducing the *exact* race deterministically
// (Playwright intercepts and delays the get_visit_billing_detail RPC,
// rather than relying on luck of real network timing):
//   A) A brief connectivity blip -- offline during the race, restored a
//      moment later (real clinic wifi flakiness). Confirm must stay
//      blocked until the request settles, then print the real data.
//   B) A genuine, sustained outage -- offline throughout. Confirm must
//      still unblock (bounded, not indefinite) and print must still
//      fire per non-negotiable #7, honestly with no prescription data
//      cached, matching Phase F's already-documented "never fetched
//      while online" boundary -- not a new bug, the accepted fallback.
//
// Run from the project root: node scripts/offline-print-test.mjs

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
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)

// Fixture: a fresh visit with a REAL prescribed medicine, so a print
// showing "No medicines prescribed" is unambiguously wrong, not vacuous.
async function makeFixture(label) {
  const stamp = `${label} ${Date.now()}.${Math.random().toString().slice(2, 6)}`
  const { data: patient } = await doctorA.from('patients').insert({ clinic_id: CLINIC_A_ID, name: stamp, age: 29 }).select('id').single()
  const { data: visit } = await doctorA.from('visits').insert({ clinic_id: CLINIC_A_ID, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint: 'offline print timing test' }).select('id').single()
  const { data: medicine } = await doctorA.from('medicines').select('id').eq('clinic_id', CLINIC_A_ID).limit(1).single()
  const { data: prescription } = await doctorA.from('prescriptions').insert({ clinic_id: CLINIC_A_ID, visit_id: visit.id }).select('id').single()
  await doctorA.from('prescription_items').insert({
    clinic_id: CLINIC_A_ID,
    prescription_id: prescription.id,
    medicine_id: medicine.id,
    drug_type: 'Tablet',
    strength: '500mg',
    before_after_food: 'After food',
    dosage_frequency: '1-0-1',
    duration_days: 5,
    quantity_dispensed: 10,
  })
  await doctorA.from('visits').update({ stage: 'with_doctor' }).eq('id', visit.id)
  await doctorA.from('visit_pricing').update({ final_amount_paise: 15000 }).eq('visit_id', visit.id)
  await doctorA.from('visits').update({ stage: 'packing' }).eq('id', visit.id)
  console.log(`fixture: visit ${visit.id} ("${stamp}") with a real prescription, at packing`)
  return stamp
}

async function signInAsReception(page) {
  await page.goto('http://localhost:4173')
  await page.locator('#signin-email').fill('reception.a@staging.test')
  await page.locator('#signin-password').fill(userEnv.TEST_RECEPTION_A_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('.worklist', { timeout: 10000 })
}

// Delays get_visit_billing_detail until releaseDetail() is called, and
// resolves requestSent the instant the browser actually issues the
// request -- detail's query is only *enabled* once the visit's stage has
// become ready_at_reception, which itself depends on openBill's own
// mutation completing first (a separate round trip from the pricing
// query that drives "Amount to collect"), so the request may not even
// start until a moment after the amount is already visible on screen.
function interceptDetailRequest(page) {
  let releaseDetail
  const detailDelay = new Promise((resolve) => {
    releaseDetail = resolve
  })
  let markRequestSent
  const requestSent = new Promise((resolve) => {
    markRequestSent = resolve
  })
  return {
    requestSent,
    releaseDetail: () => releaseDetail(),
    armed: page.route('**/rest/v1/rpc/get_visit_billing_detail', async (route) => {
      markRequestSent()
      await detailDelay
      await route.continue()
    }),
  }
}

function stubPrint(page) {
  return page.addInitScript(() => {
    window.__printCallCount = 0
    window.print = () => {
      window.__printCallCount += 1
    }
  })
}

const browser = await chromium.launch()

// ============================================================
// Scenario A: a brief connectivity blip. Offline during the race,
// restored before the held-back request is released -- proves the fix
// doesn't just block Confirm, it lets the real data actually arrive and
// print correctly once the blip passes.
// ============================================================
{
  const stamp = await makeFixture('Offline Print Blip')
  const context = await browser.newContext()
  const page = await context.newPage()
  await stubPrint(page)
  const { requestSent, releaseDetail } = interceptDetailRequest(page)

  await signInAsReception(page)
  await page.locator('.worklist-row', { hasText: stamp }).click()
  await page.waitForSelector('.bill-final-amount-value', { timeout: 10000 })
  await requestSent
  // The exact moment the original audit's repro went offline.
  await context.setOffline(true)

  const confirmButton = page.locator('.action-row .primary-button').first()
  report('Confirm payment is not clickable while detail is still genuinely in flight', await confirmButton.isDisabled())

  // The blip passes -- connectivity restored, then the held-back
  // request is allowed through.
  await context.setOffline(false)
  releaseDetail()
  await page.waitForTimeout(1000)

  report('Confirm payment unblocks once detail resolves', !(await confirmButton.isDisabled()))

  await confirmButton.click()
  await page.waitForTimeout(800)
  report('print fires', (await page.evaluate(() => window.__printCallCount)) === 1)

  const printArea = await page.locator('.print-area').innerHTML()
  report(
    'the printed slip shows the real prescription once the blip passes, not "No medicines prescribed"',
    printArea.includes('500mg') || printArea.includes('Tablet'),
    printArea.includes('No medicines prescribed') ? 'shows the empty-prescription fallback' : 'ok',
  )

  await context.close()
}

// ============================================================
// Scenario B: a genuine, sustained outage. Offline throughout -- proves
// Confirm still unblocks (bounded, not indefinite) and print still
// fires per non-negotiable #7. No prescription data was ever cached for
// this visit, so the honest empty-prescription slip here is the
// already-accepted Phase F boundary, not a new failure.
// ============================================================
{
  const stamp = await makeFixture('Offline Print Outage')
  const context = await browser.newContext()
  const page = await context.newPage()
  await stubPrint(page)
  const { requestSent } = interceptDetailRequest(page) // never released -- simulates a request that never gets a reply

  await signInAsReception(page)
  await page.locator('.worklist-row', { hasText: stamp }).click()
  await page.waitForSelector('.bill-final-amount-value', { timeout: 10000 })
  await requestSent
  await context.setOffline(true)

  const confirmButton = page.locator('.action-row .primary-button').first()
  report('(outage) Confirm payment is not clickable the instant connectivity drops', await confirmButton.isDisabled())

  const start = Date.now()
  await confirmButton.waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('.action-row .primary-button')?.disabled, null, { timeout: 5000 })
  const unblockedAfterMs = Date.now() - start
  report(
    `(outage) Confirm payment still unblocks within a bounded wait (${unblockedAfterMs}ms, not indefinite)`,
    unblockedAfterMs < 5000,
    `${unblockedAfterMs}ms`,
  )

  await confirmButton.click()
  await page.waitForTimeout(800)
  report('(outage) print still fires -- non-negotiable #7 holds even with data never cached', (await page.evaluate(() => window.__printCallCount)) === 1)

  await context.close()
}

await browser.close()

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
