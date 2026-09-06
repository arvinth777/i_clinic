// TDD-adjacent verification for Phase A (docs/build-plan.md): admin RLS
// on the new drug/procedure/template/custom-field surfaces, and
// merge_patients. Same convention as the other scripts: a plain script
// against live staging, signed in as the real roles, no framework.
// Run from the project root: node scripts/admin-phase-test.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import ws from 'ws'

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
const SUPABASE_URL = appEnv.VITE_SUPABASE_URL
const ANON_KEY = appEnv.VITE_SUPABASE_ANON_KEY
const CLINIC_A_ID = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'

const results = []
function report(label, pass, detail) {
  results.push({ label, pass })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${label}${detail ? ' -- ' + detail : ''}`)
}

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { realtime: { transport: ws } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)
const adminOnly = await signIn('admin.only@staging.test', userEnv.TEST_ADMIN_ONLY_PASSWORD)
console.log('signed in as doctor.a, reception.a, admin.only\n')

// ================================================================
// Section 1 -- medicines: admin CRUD with the new fields, reception blocked
// ================================================================
{
  const stamp = Date.now() + Math.random()
  const { data: med, error } = await adminOnly
    .from('medicines')
    .insert({
      clinic_id: CLINIC_A_ID, name: `Admin Test Med ${stamp}`, price_paise: 5000,
      drug_type: 'Tablet', strength_options: ['250mg', '500mg'], low_stock_threshold: 10, expiry_date: '2027-01-01',
    })
    .select('id, drug_type, strength_options, low_stock_threshold, expiry_date')
    .single()
  report('admin can add a medicine with type/strength/threshold/expiry', !error && med?.drug_type === 'Tablet' && med?.low_stock_threshold === 10, error?.message ?? JSON.stringify(med))

  const { error: updateErr } = await adminOnly.from('medicines').update({ price_paise: 6000 }).eq('id', med.id)
  report('admin can edit a medicine', !updateErr, updateErr?.message)

  const { error: recErr, data: recData } = await receptionA.from('medicines').insert({ clinic_id: CLINIC_A_ID, name: `Reception Test Med ${stamp}`, price_paise: 100 }).select()
  report('reception cannot add a medicine', !!recErr || (recData ?? []).length === 0, recErr?.message ?? JSON.stringify(recData))

  const { error: delErr } = await adminOnly.from('medicines').delete().eq('id', med.id)
  report('admin can remove an unused medicine', !delErr, delErr?.message)
}

// ================================================================
// Section 2 -- prescription templates: admin view/rename/delete, doctor
// still creates; reception blocked entirely
// ================================================================
{
  const stamp = Date.now() + Math.random()
  const { data: tpl, error } = await doctorA.from('prescription_templates').insert({ clinic_id: CLINIC_A_ID, name: `Admin Phase Template ${stamp}` }).select('id').single()
  report('doctor can still create a template', !error, error?.message)

  const { data: seen, error: selErr } = await adminOnly.from('prescription_templates').select('id, name').eq('id', tpl.id).single()
  report('admin can view a template', !selErr && seen?.id === tpl.id, selErr?.message)

  const { error: renameErr } = await adminOnly.from('prescription_templates').update({ name: `Renamed ${stamp}` }).eq('id', tpl.id)
  report('admin can rename a template', !renameErr, renameErr?.message)

  const { error: recSelErr, data: recSelData } = await receptionA.from('prescription_templates').select('id').eq('id', tpl.id)
  report('reception cannot see prescription templates', !recSelErr && (recSelData ?? []).length === 0, JSON.stringify(recSelData))

  const { error: delErr } = await adminOnly.from('prescription_templates').delete().eq('id', tpl.id)
  report('admin can delete a template (items cascade)', !delErr, delErr?.message)
}

// ================================================================
// Section 3 -- custom patient fields: admin manages definitions, values
// round-trip through patients.custom_fields
// ================================================================
{
  const stamp = Date.now() + Math.random()
  const key = `pain_score_${Math.floor(Math.random() * 100000)}`
  const { data: def, error } = await adminOnly
    .from('patient_field_definitions')
    .insert({ clinic_id: CLINIC_A_ID, key, label: 'Pain score (0-10)', field_type: 'number', display_order: 1 })
    .select('id')
    .single()
  report('admin can define a custom patient field, no migration involved', !error, error?.message)

  const { data: seenByDoctor, error: docErr } = await doctorA.from('patient_field_definitions').select('key').eq('id', def.id).single()
  report('doctor can read the field definition', !docErr && seenByDoctor?.key === key, docErr?.message)

  await receptionA.from('patient_field_definitions').update({ label: 'hijacked' }).eq('id', def.id)
  const { data: stillOriginal } = await adminOnly.from('patient_field_definitions').select('label').eq('id', def.id).single()
  report('reception cannot edit a field definition', stillOriginal?.label === 'Pain score (0-10)', JSON.stringify(stillOriginal))

  const { data: patient, error: patErr } = await receptionA
    .from('patients')
    .insert({ clinic_id: CLINIC_A_ID, name: `Custom Field Test Patient ${stamp}`, age: 40, custom_fields: { [key]: 7 } })
    .select('custom_fields')
    .single()
  report('a custom field value round-trips through patients.custom_fields', !patErr && patient?.custom_fields?.[key] === 7, patErr?.message ?? JSON.stringify(patient))

  await adminOnly.from('patient_field_definitions').delete().eq('id', def.id)
}

// ================================================================
// Section 4 -- merge_patients
// ================================================================
{
  const stamp = Date.now() + Math.random()
  const { data: older } = await receptionA.from('patients').insert({ clinic_id: CLINIC_A_ID, name: `Merge Test Older ${stamp}`, age: 60 }).select('id, created_at').single()
  await new Promise((r) => setTimeout(r, 1100)) // ensure a distinct created_at ordering
  const { data: newer } = await receptionA.from('patients').insert({ clinic_id: CLINIC_A_ID, name: `Merge Test Newer ${stamp}`, age: 60 }).select('id, created_at').single()

  // give the newer one an open visit today -- merge must refuse
  const { data: openVisit } = await receptionA.from('visits').insert({ clinic_id: CLINIC_A_ID, patient_id: newer.id, arrived_at: new Date().toISOString(), complaint: 'merge test open visit' }).select('id').single()

  const { data: blockedResult, error: blockedErr } = await adminOnly.rpc('merge_patients', { p_patient_a: older.id, p_patient_b: newer.id })
  report('merge refuses when either patient has an open visit today', !!blockedErr && !blockedResult, blockedErr?.message)

  // close it out, then merge should succeed -- passed in the "wrong" order
  // (newer first) to also prove it keeps the actually-older id regardless
  await receptionA.from('visits').update({ stage: 'paid', closed_at: new Date().toISOString() }).eq('id', openVisit.id)
  const { data: pastVisit } = await receptionA.from('visits').insert({ clinic_id: CLINIC_A_ID, patient_id: newer.id, arrived_at: new Date(Date.now() - 86400000).toISOString(), complaint: 'a past visit to reassign', stage: 'paid', closed_at: new Date().toISOString() }).select('id').single()
  const { data: comment } = await doctorA.from('patient_comments').insert({ clinic_id: CLINIC_A_ID, patient_id: newer.id, author_id: (await doctorA.auth.getUser()).data.user.id, body: 'a comment to reassign' }).select('id').single()

  const { data: keptId, error: mergeErr } = await adminOnly.rpc('merge_patients', { p_patient_a: newer.id, p_patient_b: older.id })
  report('merge succeeds once no open visit remains, keeps the actually-older id', !mergeErr && keptId === older.id, mergeErr?.message ?? `kept ${keptId}, expected ${older.id}`)

  // admin correctly has no row-level SELECT on visits at all (by design --
  // see docs/architecture-spec.md's Phase E constraint, already true today)
  // -- check via reception, who does.
  const { data: reassignedVisit } = await receptionA.from('visits').select('patient_id').eq('id', pastVisit.id).single()
  report('the reassigned visit now points at the kept patient', reassignedVisit?.patient_id === older.id, JSON.stringify(reassignedVisit))

  const { data: reassignedComment } = await doctorA.from('patient_comments').select('patient_id').eq('id', comment.id).single()
  report('the reassigned comment now points at the kept patient', reassignedComment?.patient_id === older.id, JSON.stringify(reassignedComment))

  const { data: removedPatient } = await adminOnly.from('patients').select('id').eq('id', newer.id)
  report('the retired (newer) patient no longer exists', (removedPatient ?? []).length === 0, JSON.stringify(removedPatient))

  const { error: recBlockedErr } = await receptionA.rpc('merge_patients', { p_patient_a: older.id, p_patient_b: older.id })
  report('reception cannot call merge_patients at all', !!recBlockedErr, recBlockedErr?.message)
}

// ================================================================
// Section 5 -- the two narrow admin RPCs backing the Admin screen
// ================================================================
{
  const { data, error } = await adminOnly.rpc('list_clinic_logins', { p_clinic_id: CLINIC_A_ID })
  const hasAdminOnly = (data ?? []).some((r) => r.email === 'admin.only@staging.test' && r.role === 'admin')
  report('admin can list clinic logins with email + role', !error && hasAdminOnly, error?.message ?? JSON.stringify(data?.slice(0, 2)))

  const { data: recData, error: recErr } = await receptionA.rpc('list_clinic_logins', { p_clinic_id: CLINIC_A_ID })
  report('reception gets nothing from list_clinic_logins', !recErr && (recData ?? []).length === 0, JSON.stringify(recData))
}
{
  const { data, error } = await adminOnly.rpc('admin_search_patients_for_merge', { p_clinic_id: CLINIC_A_ID, p_query: 'Rajesh' })
  report('admin can search patients for merge (name/age/phone only)', !error && (data ?? []).length > 0 && 'name' in (data[0] ?? {}), error?.message ?? JSON.stringify(data?.[0]))

  const { data: recData, error: recErr } = await receptionA.rpc('admin_search_patients_for_merge', { p_clinic_id: CLINIC_A_ID, p_query: 'Rajesh' })
  report('reception gets nothing from admin_search_patients_for_merge', !recErr && (recData ?? []).length === 0, JSON.stringify(recData))
}

console.log('\n== Summary ==')
const failed = results.filter((r) => !r.pass)
console.log(`${results.length - failed.length}/${results.length} passed`)
if (failed.length) {
  for (const f of failed) console.log(`  FAIL - ${f.label}`)
  process.exitCode = 1
}
