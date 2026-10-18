// The offline print suite (rewritten 2026-10-19 for the current billing screen).
//
// Guarantee under test (non-negotiable #7, "printing works with zero connectivity"): the receipt is printed from what the
// bill screen already holds, and "Mark paid" is held back only while that data is still genuinely loading.
//   A) A brief connectivity blip while the bill's detail request is in flight: "Mark paid" stays blocked, unblocks once the
//      detail arrives, and the printed receipt shows the real medicine.
//   B) Connectivity lost after the bill is open: "Mark paid" still works (queued, "not saved yet") and still prints the
//      real medicine.
//   C) A detail request that never gets a reply: "Mark paid" stays blocked rather than printing an empty receipt.
//
// Live Playwright script against the PRODUCTION build (`npm run build` then `vite preview` on 4173 -- the service worker is
// disabled under `npm run dev`), against staging with synthetic data. Run with Node 24 from the project root:
//   node scripts/offline-print-test.mjs

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import ws from 'ws'
import { checked, consultationOnlyFixture } from './clinic-workflow-fixture.mjs'

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
const APP = 'http://localhost:4173'

const results = []
function report(label, pass, detail) {
  results.push({ label, pass })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ' -- ' + detail : ''}`)
}

async function signIn(email, password) {
  const client = createClient(appEnv.VITE_SUPABASE_URL, appEnv.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } })
  checked(await client.auth.signInWithPassword({ email, password }))
  return client
}
const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)

const fixtureVisits = []
// Fixture: a visit that is ready to bill with a real, stocked, unit-confirmed medicine, so an empty receipt is unambiguously wrong.
async function makeFixture(label) {
  const stamp = `${label} ${Date.now()}.${Math.random().toString().slice(2, 6)}`
  const patient = checked(await receptionA.from('patients').insert({ clinic_id: CLINIC_A_ID, name: stamp, age: 29 }).select('id').single())
  const visit = checked(await receptionA.from('visits').insert({ clinic_id: CLINIC_A_ID, patient_id: patient.id, arrived_at: new Date().toISOString(), complaint: 'offline print test' }).select('id').single())
  await consultationOnlyFixture(doctorA, receptionA, CLINIC_A_ID, visit.id)
  fixtureVisits.push(visit.id)
  console.log(`fixture: "${stamp}" ready to bill`)
  return stamp
}

async function signInAsReception(page) {
  await page.goto(APP)
  await page.locator('#signin-email').fill('reception.a@staging.test')
  await page.locator('#signin-password').fill(userEnv.TEST_RECEPTION_A_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('.queue-patients, .queue-worklist', { timeout: 15000 })
}

async function openBill(page, stamp) {
  await page.locator('nav.shell-nav a[href="#billing"]').click()
  await page.locator('.record-selector', { hasText: stamp }).click()
}
const markPaid = page => page.locator('button[data-press="stamp"]')

// Holds back get_visit_billing_detail until releaseDetail() is called (or forever, if never released), and resolves
// requestSent the instant the browser actually issues the request.
function interceptDetailRequest(page) {
  let releaseDetail
  const detailDelay = new Promise(resolve => { releaseDetail = resolve })
  let markRequestSent
  const requestSent = new Promise(resolve => { markRequestSent = resolve })
  return {
    requestSent,
    releaseDetail: () => releaseDetail(),
    armed: page.route('**/rest/v1/rpc/get_visit_billing_detail', async route => {
      markRequestSent()
      await detailDelay
      await route.continue().catch(() => {})
    }),
  }
}

const stubPrint = page => page.addInitScript(() => {
  window.__printCallCount = 0
  window.print = () => { window.__printCallCount += 1 }
})

const browser = await chromium.launch()

// ---- A) a brief blip while the detail is in flight ----
{
  const stamp = await makeFixture('Offline Print Blip')
  const context = await browser.newContext()
  const page = await context.newPage()
  await stubPrint(page)
  const { requestSent, releaseDetail, armed } = interceptDetailRequest(page)
  await armed
  await signInAsReception(page)
  await openBill(page, stamp)
  await requestSent
  await context.setOffline(true)
  report('(blip) Mark paid is blocked while the detail request is genuinely in flight', await markPaid(page).isDisabled())
  await context.setOffline(false)
  releaseDetail()
  await page.waitForFunction(() => { const b = document.querySelector('button[data-press="stamp"]'); return b && !b.disabled }, null, { timeout: 15000 })
  report('(blip) Mark paid unblocks once the detail resolves', !(await markPaid(page).isDisabled()))
  await markPaid(page).click()
  await page.waitForTimeout(1200)
  report('(blip) print fires once', (await page.evaluate(() => window.__printCallCount)) === 1)
  const printArea = await page.locator('.print-area').innerHTML()
  report('(blip) the printed receipt shows the real medicine', printArea.includes('consultation fixture'), printArea.includes('rcpt') ? 'receipt rendered' : 'no receipt rendered')
  await context.close()
}

// ---- B) connectivity lost after the bill is open ----
{
  const stamp = await makeFixture('Offline Print Outage')
  const context = await browser.newContext()
  const page = await context.newPage()
  await stubPrint(page)
  await signInAsReception(page)
  await openBill(page, stamp)
  await page.waitForFunction(() => { const b = document.querySelector('button[data-press="stamp"]'); return b && !b.disabled }, null, { timeout: 15000 })
  await context.setOffline(true)
  await markPaid(page).click()
  await page.waitForTimeout(1500)
  report('(outage) print still fires with zero connectivity', (await page.evaluate(() => window.__printCallCount)) === 1)
  const printArea = await page.locator('.print-area').innerHTML()
  report('(outage) the printed receipt shows the real medicine', printArea.includes('consultation fixture'))
  report('(outage) the app says the payment is not saved yet', (await page.getByText(/not saved yet|waiting for a connection/i).count()) > 0)
  await context.close()
}

// ---- C) a detail request that never gets a reply ----
{
  const stamp = await makeFixture('Offline Print Never')
  const context = await browser.newContext()
  const page = await context.newPage()
  await stubPrint(page)
  const { requestSent, armed } = interceptDetailRequest(page) // never released
  await armed
  await signInAsReception(page)
  await openBill(page, stamp)
  await requestSent
  await page.waitForTimeout(3000)
  report('(never) Mark paid stays blocked rather than printing an empty receipt', await markPaid(page).isDisabled())
  report('(never) nothing was printed', (await page.evaluate(() => window.__printCallCount)) === 0)
  await context.close()
}

await browser.close()
// Leave no unpaid fixture visit in the staging queue (paid ones cannot be cancelled and are simply skipped).
for (const id of fixtureVisits) await receptionA.rpc('queue_visit_action', { p_visit_id: id, p_action: 'cancel', p_request_id: crypto.randomUUID(), p_reason: 'offline print test cleanup' })
for (const client of [doctorA, receptionA]) await client.auth.signOut({ scope: 'local' })

console.log('\n== Summary ==')
const failed = results.filter(r => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
