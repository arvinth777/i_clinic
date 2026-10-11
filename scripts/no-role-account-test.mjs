// Verifies the real production case of a login added with the role
// forgotten: signing in with an account that holds zero user_roles rows
// must show a clear "no access" message, not a broken screen or a
// console crash. Every other test in this repo is API-level only; this
// one specifically checks rendered UI, so it's the one script here that
// drives a real browser (Playwright, already a project dependency) --
// requires the dev server running locally (npm run dev, default
// http://localhost:5173).
//
// Run from the project root: node scripts/no-role-account-test.mjs

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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const consoleErrors = []
page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`[console.error] ${m.text()}`)
})

await page.goto('http://localhost:5173')
await page.waitForSelector('input[type="email"]')
await page.fill('input[type="email"]', 'noroles@staging.test')
await page.fill('input[type="password"]', userEnv.TEST_NOROLES_PASSWORD)
await page.click('button[type="submit"], button')
await page.waitForTimeout(2000)

const bodyText = await page.locator('body').innerText()
report(
  'a clear no-access message is shown',
  bodyText.includes('no role assigned') && bodyText.toLowerCase().includes('contact your admin'),
  bodyText.replace(/\n/g, ' | ').slice(0, 200),
)

const crashed = await page.locator('#root').innerHTML().then((h) => h.trim().length === 0)
report('the app does not render a blank/crashed screen', !crashed)

report('no console errors while rendering the no-access screen', consoleErrors.length === 0, consoleErrors.join('; '))

// The sign-out control must still work -- a no-access account isn't stuck.
const hasSignOut = await page.locator('button:has-text("Sign out")').count()
report('sign out is still available', hasSignOut > 0)

await browser.close()

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
