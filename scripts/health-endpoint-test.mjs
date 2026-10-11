// TDD-adjacent check for the keep-alive Edge Function (docs/architecture-
// spec.md's "Supabase keep-alive" signal): a plain script against the live
// staging endpoint, no framework, matching this repo's other scripts.
// Run from the project root: node scripts/health-endpoint-test.mjs
//
// Asserts the two things that matter for a keep-alive ping: it's genuinely
// public (no Authorization header sent -- an external uptime monitor can't
// hold a Supabase session), and it returns exactly {"ok":true} with a 200.
// It does not simulate "database unreachable" -- that's not something to
// provoke against live staging; the 500/{"ok":false} path is a direct
// reading of supabase/functions/health/index.ts, not exercised here.

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

const appEnv = loadEnv('.env.local')
const url = `${appEnv.VITE_SUPABASE_URL}/functions/v1/health`

const results = []
function report(label, pass, detail) {
  results.push({ label, pass })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ' -- ' + detail : ''}`)
}

// No Authorization header at all -- this is the actual shape of an
// external uptime monitor's request.
const res = await fetch(url)
const status = res.status
const body = await res.json().catch(() => null)

report('responds 200 with no Authorization header (genuinely public)', status === 200, `status ${status}`)
report('body is exactly {"ok":true}', body && body.ok === true && Object.keys(body).length === 1, JSON.stringify(body))

console.log(`\n== Summary ==`)
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exitCode = 1
