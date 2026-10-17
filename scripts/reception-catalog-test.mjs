// Public catalog seam: reception may create, price and retire a medicine without deleting audit history.
// Synthetic staging only; no production credentials or records are used.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const env = path => Object.fromEntries(readFileSync(path, 'utf8').split('\n').filter(line => line.trim() && !line.startsWith('#')).map(line => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]))
const app = env('.env.local')
const users = env('.env.test-users.local')
assert.equal(new URL(app.VITE_SUPABASE_URL).hostname, 'cofnrcgsolluyhghutah.supabase.co', 'staging only')
const clinicId = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'
const reception = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } })
const admin = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } })
const anon = createClient(app.VITE_SUPABASE_URL, app.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, realtime: { transport: ws } })
const id = crypto.randomUUID()
try {
  assert.ifError((await reception.auth.signInWithPassword({ email: 'reception.a@staging.test', password: users.TEST_RECEPTION_A_PASSWORD })).error)
  assert.ifError((await admin.auth.signInWithPassword({ email: 'admin.only@staging.test', password: users.TEST_ADMIN_ONLY_PASSWORD })).error)
  const row = { id, clinic_id: clinicId, name: `Reception catalog synthetic ${id}`, price_paise: 0 }
  assert.ok((await anon.from('medicines').insert(row)).error, 'anonymous create is denied')
  assert.ifError((await reception.from('medicines').insert(row)).error)
  assert.ifError((await reception.rpc('set_medicine_unit_price', { p_medicine_id: id, p_stock_unit: 'tablet', p_price_paise: 1250 })).error)
  const { data: medicine, error: readError } = await reception.from('medicines').select('stock_unit, price_paise, unit_confirmed_at, is_active').eq('id', id).single()
  assert.ifError(readError)
  assert.equal(medicine.stock_unit, 'tablet')
  assert.equal(medicine.price_paise, 1250)
  assert.ok(medicine.unit_confirmed_at)
  const { data: audit, error: auditError } = await reception.from('medicine_price_changes').select('old_price_paise, new_price_paise, changed_by').eq('medicine_id', id).single()
  assert.ifError(auditError)
  assert.equal(audit.old_price_paise, 0)
  assert.equal(audit.new_price_paise, 1250)
  assert.ok(audit.changed_by)
  assert.ok((await anon.rpc('retire_medicine', { p_medicine_id: id })).error, 'anonymous retirement denied')
  assert.ifError((await admin.rpc('retire_medicine', { p_medicine_id: id })).error)
  const { data: retired, error: retiredError } = await reception.from('medicines').select('is_active').eq('id', id).single()
  assert.ifError(retiredError)
  assert.equal(retired.is_active, false, 'retired medicine remains available for historical references')
  const blockedSale = await reception.rpc('save_pharmacy_sale', {
    p_sale_id: crypto.randomUUID(), p_clinic_id: clinicId, p_customer_name: 'Synthetic retired medicine check',
    p_items: [{ medicine_id: id, quantity: 1, stock_unit: 'tablet', unit_price_paise: 1250 }],
  })
  assert.match(blockedSale.error?.message ?? '', /retired/, 'retired medicine cannot enter a new pharmacy bill')
  console.log('PASS: reception create/unit/price/audit, admin retire, retired sale blocked; anonymous mutation denied')
} finally {
  await reception.rpc('retire_medicine', { p_medicine_id: id })
  await reception.auth.signOut()
  await admin.auth.signOut()
}
