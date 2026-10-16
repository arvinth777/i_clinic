import { spawnSync } from 'node:child_process'
const suites = ['patient-timeline', 'clinic-alerts', 'document-upload-queue', 'offline-queue-owner', 'prescription-draft', 'print-readiness', 'queue-performance']
let failed = 0
for (const suite of suites) {
  const result = spawnSync(process.execPath, [`scripts/${suite}-test.mjs`], { stdio: 'inherit', timeout: 30_000 })
  if (result.status !== 0) { failed++; console.error(`FAIL: ${suite}${result.error ? ` (${result.error.code})` : ''}`) }
}
console.log(`${suites.length - failed}/${suites.length} unit suites passed`)
process.exitCode = failed ? 1 : 0
