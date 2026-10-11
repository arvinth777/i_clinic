import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const { outputText } = ts.transpileModule(readFileSync('src/lib/date.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022 } })
const { expiryStatus } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
assert.equal(expiryStatus('2026-10-09', '2026-10-10'), 'Expired')
assert.equal(expiryStatus('2026-10-10', '2026-10-10'), 'Expires today')
assert.equal(expiryStatus('2026-11-09', '2026-10-10'), 'Expires within 30 days')
assert.equal(expiryStatus('2026-11-10', '2026-10-10'), null)
assert.equal(expiryStatus(null, '2026-10-10'), null)
console.log('PASS: expiry alerts include today and the 30-day boundary')
