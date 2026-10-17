import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
const suites = ['patient-timeline', 'clinic-alerts', 'document-upload-queue', 'offline-queue-owner', 'prescription-draft', 'clinic-learning', 'print-readiness', 'queue-performance']
if (existsSync('scripts/issued-prescription-view-test.mjs')) suites.push('issued-prescription-view')
let failed = 0
for (const suite of suites) {
  const result = spawnSync(process.execPath, [`scripts/${suite}-test.mjs`], { stdio: 'inherit', timeout: 30_000 })
  if (result.status !== 0) { failed++; console.error(`FAIL: ${suite}${result.error ? ` (${result.error.code})` : ''}`) }
}
console.log(`${suites.length - failed}/${suites.length} unit suites passed`)
process.exitCode = failed ? 1 : 0
