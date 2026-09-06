// Live browser test for the "patient name in an unauthenticated/locked
// banner" fix (docs/STATUS.md's Medium finding). Pure client-side
// behaviour -- same convention as no-role-account-test.mjs/
// idle-lock-test.mjs, the other scripts in this repo that drive a real
// browser for exactly this reason.
//
// Uses a temporary window.__debugQueue hook (main.tsx) to force a
// genuinely halted mutation deterministically, rather than staging a
// real network failure -- the halt mechanism itself is already covered
// by offlineQueue.ts's own tests; this script only needs a reliable way
// to get a halted banner on screen with a known description.
//
// Requires the dev server running at localhost:5173 (npm run dev) with
// the debug hook temporarily present in main.tsx.
// Run from the project root: node scripts/patient-info-redaction-test.mjs

import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

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
const userEnv = loadEnv('.env.test-users.local')
const MARKER = `PATIENT_NAME_MARKER_${Date.now()}`

const results = []
function report(label, pass, detail) {
  results.push({ label, pass })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ' -- ' + detail : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()

await page.goto('http://localhost:5173')
await page.locator('#signin-email').fill('reception.a@staging.test')
await page.locator('#signin-password').fill(userEnv.TEST_RECEPTION_A_PASSWORD)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForSelector('.shell-nav', { timeout: 10000 })

// Force a genuine halt: a queued update against a row that doesn't
// exist matches zero rows -- a real rejection (offlineQueue.ts's own
// zero-rows check), not a network failure, so it halts rather than
// retrying quietly.
await page.evaluate(async (marker) => {
  const q = window.__debugQueue
  await q.enqueue({
    kind: 'update',
    table: 'visits',
    match: { id: '00000000-0000-0000-0000-000000000000' },
    payload: { stage: 'waiting' },
    description: `Open bill for ${marker}`,
  })
  await q.drainQueue()
}, MARKER)
await page.waitForTimeout(500)

report('the halted banner is showing', (await page.locator('.offline-queue-banner-halted').count()) === 1)
report('authenticated + unlocked: the patient name IS visible (legitimate use)', (await page.getByText(MARKER).count()) === 1)

// ---- Lock the screen ----
await page.getByLabel('Set a lock PIN').click()
await page.locator('#new-pin').fill('4242')
await page.locator('#confirm-pin').fill('4242')
await page.getByRole('button', { name: 'Save PIN' }).click()
await page.waitForTimeout(300)
await page.getByLabel('Lock screen now').click()
await page.waitForTimeout(300)

report('locked: the patient name is no longer in the rendered page', (await page.getByText(MARKER).count()) === 0)
report('locked: the halted banner still shows *something* (not silently dropped)', (await page.locator('.offline-queue-banner-halted').count()) === 1)

await page.locator('.lock-screen-input').fill('4242')
await page.getByRole('button', { name: 'Unlock' }).click()
await page.waitForTimeout(300)
report('unlocked again: the patient name is visible once more', (await page.getByText(MARKER).count()) === 1)

// ---- Sign out ----
await page.getByRole('button', { name: 'Sign out' }).click()
await page.waitForSelector('#signin-email', { timeout: 10000 })
report('signed out: the patient name is not on the sign-in screen', (await page.getByText(MARKER).count()) === 0)
report('signed out: the halted banner still shows *something* (queue survives sign-out, by design)', (await page.locator('.offline-queue-banner-halted').count()) === 1)

await browser.close()

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
