import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const url = new URL(process.env.PATIENT_DOCUMENT_TEST_DB ?? '')
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.startsWith('/clinic_document_test'), 'Use a disposable local clinic_document_test database only')
const sql = ['scripts/fixtures/patient-documents/schema.sql', 'supabase/migrations/20261011120000_patient_drive_files.sql', 'scripts/fixtures/patient-documents/assertions.sql'].map(file => readFileSync(file, 'utf8')).join('\n')
const output = execFileSync('psql', [url.toString(), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })
console.log(output.split('\n').filter(line => line.startsWith('PASS:')).join('\n'))
