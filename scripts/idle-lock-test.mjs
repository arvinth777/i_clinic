// Live browser test for the idle-lock/PIN feature (docs/STATUS.md's
// Critical finding #2 -- docs/architecture-spec.md's "Auth: session and
// idle-lock policy" was entirely unimplemented before this fix). Pure
// client-side behaviour (localStorage + timers + React state, no DB
// round trip), so this is the one script that drives a real browser --
// same convention as scripts/no-role-account-test.mjs, for the same
// reason: a rendered-UI behaviour no API-level check can verify.
//
// Requires the dev server running at localhost:5173 (npm run dev).
// Run from the project root: node scripts/idle-lock-test.mjs

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

const results = []
function report(label, pass, detail) {
  results.push({ label, pass })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ' -- ' + detail : ''}`)
}

const browser = await chromium.launch()
// Fresh, private context -- a clean localStorage, so no PIN is set yet
// regardless of what a previous manual session left behind on this box.
const context = await browser.newContext()
const page = await context.newPage()

await page.goto('http://localhost:5173')
await page.locator('#signin-email').fill('doctor.a@staging.test')
await page.locator('#signin-password').fill(userEnv.TEST_DOCTOR_A_PASSWORD)
await page.getByRole('button', { name: 'Sign in' }).click()
await page.waitForSelector('.shell-nav', { timeout: 10000 })

report('no Lock button before a PIN is set', (await page.getByLabel('Lock screen now').count()) === 0)

// ---- Set a PIN ----
await page.getByLabel('Set a lock PIN').click()
await page.locator('#new-pin').fill('4242')
await page.locator('#confirm-pin').fill('4242')
await page.getByRole('button', { name: 'Save PIN' }).click()
await page.waitForTimeout(300)

report('Lock button appears once a PIN is set', (await page.getByLabel('Lock screen now').count()) === 1)

// ---- In-progress work: something typed, to prove it survives a lock/unlock cycle ----
await page.getByRole('button', { name: 'Merge patients' }).click()
await page.waitForTimeout(300)
const draftText = `draft-${Date.now()}`
const searchInput = page.locator('.merge-patients-page input').first()
await searchInput.fill(draftText)
report('draft text is actually in the field before locking', (await searchInput.inputValue()) === draftText)

// ---- Manual lock (requirement 11) ----
await page.getByLabel('Lock screen now').click()
await page.waitForTimeout(300)
report('the lock screen renders on manual lock', (await page.locator('.lock-screen').count()) === 1)

// Requirement 12: no application state visible. The whole viewport must
// hit the lock screen, not whatever's underneath -- checked by asking the
// browser what element actually occupies a point where a nav button sits,
// not just whether .lock-screen exists in the DOM somewhere.
const hitsLockScreen = await page.evaluate(() => {
  const el = document.elementFromPoint(200, 20)
  return !!el && !!el.closest('.lock-screen')
})
report('the nav/header area is actually covered, not just present underneath', hitsLockScreen)

// ---- Wrong PIN ----
await page.locator('.lock-screen-input').fill('0000')
await page.getByRole('button', { name: 'Unlock' }).click()
await page.waitForTimeout(300)
report('wrong PIN shows an error and stays locked', (await page.getByText('Wrong PIN.').count()) === 1 && (await page.locator('.lock-screen').count()) === 1)

// ---- Correct PIN ----
await page.locator('.lock-screen-input').fill('4242')
await page.getByRole('button', { name: 'Unlock' }).click()
await page.waitForTimeout(300)
report('correct PIN unlocks', (await page.locator('.lock-screen').count()) === 0)

// Requirement 13: unlocking returns to the exact draft -- the underlying
// form was never unmounted, so the text typed before locking is still
// there with no re-navigation needed.
report('the draft field still holds what was typed before locking (no unmount)', (await searchInput.inputValue()) === draftText)

// ---- Idle auto-lock, doctor's own 15-minute window ----
// Installed and only then reloaded, so the idle timer's setTimeout is
// scheduled fresh under the fake clock from the moment AppShell remounts
// -- installing mid-session (after real timers were already scheduled by
// the real clock) left this same assertion unable to observe the fake
// clock's fast-forward.
await context.clock.install({ time: Date.now() })
await page.reload()
await page.waitForSelector('.shell-nav', { timeout: 10000 })
await context.clock.fastForward('16:00')
await page.waitForTimeout(300)
report('idle timeout auto-locks after the doctor\'s 15-minute window', (await page.locator('.lock-screen').count()) === 1)

await browser.close()

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
