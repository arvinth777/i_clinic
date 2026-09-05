// One-off tenant/role isolation check against staging. Reads secrets from
// local env files itself -- .env.local (anon key) and .env.test-users.local
// (test-user passwords) -- and never prints their values, only pass/fail.
// Run with: node isolation-test.mjs   (from the project root)

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import ws from 'ws' // Node 20 has no native WebSocket the realtime client can use; browsers do.

function loadEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return out
}

const appEnv = loadEnv('.env.local')
const userEnv = loadEnv('.env.test-users.local')

const SUPABASE_URL = appEnv.VITE_SUPABASE_URL
const ANON_KEY = appEnv.VITE_SUPABASE_ANON_KEY

// Known fixture IDs from the seed migration (public data -- not secrets).
const CLINIC_B_ID = '556c2ce6-dfcc-4d47-a3d5-a37666fe338b'
const CLINIC_B_PATIENT_ID = '5c2d816d-dbf9-44d2-a950-35bae4024170'
const LAKSHMI_VISIT_ID = '9f0474aa-3b00-478f-9a34-a9d63455d45f'
const MEENA_VISIT_ID = '4900e138-8c17-40cd-91f7-32f0d49234bd' // stage='paid'
const MEENA_BILL_ID = '80a699d4-8db6-4ac6-bb3c-415d3051bf59' // original bill, corrects_bill_id=null
const CLINIC_A_ID = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'

const results = []
function report(label, pass, detail) {
  const tag = pass === null ? 'N/A ' : pass ? 'PASS' : 'FAIL'
  results.push({ label, pass, detail })
  console.log(`[${tag}] ${label}${detail ? ' -- ' + detail : ''}`)
}

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { realtime: { transport: ws } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

async function main() {
  const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
  const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)
  const adminOnly = await signIn('admin.only@staging.test', userEnv.TEST_ADMIN_ONLY_PASSWORD)

  let doctorB = null
  try {
    doctorB = await signIn('doctor.b@staging.test', userEnv.TEST_DOCTOR_B_PASSWORD)
  } catch (e) {
    console.log(`note: doctor.b sign-in failed (${e.message}) -- skipping the realtime check that needs it, running everything else`)
  }
  console.log('signed in as doctor.a, reception.a, admin.only\n')

  // ================================================================
  // Boundary 1: cross-clinic -- as doctor.a, attempt clinic B
  // ================================================================
  console.log('-- Boundary 1: cross-clinic (doctor.a vs clinic B) --')

  for (const table of ['patients', 'visits', 'bills', 'prescriptions', 'patient_comments']) {
    const { data, error } = await doctorA.from(table).select('*').eq('clinic_id', CLINIC_B_ID)
    const empty = !error && Array.isArray(data) && data.length === 0
    report(`PostgREST: doctor.a reading ${table} filtered to clinic B`, empty,
      error ? `error: ${error.message}` : `rows returned: ${data?.length ?? 'n/a'}`)
  }

  // search_patients is SECURITY INVOKER -- adversarial test: pass clinic
  // B's own id explicitly (not just search within one's own clinic), with
  // a query matching clinic B's real patient, and confirm the underlying
  // patients_select RLS still blocks it regardless of what clinic_id the
  // caller asks for.
  {
    const { data, error } = await doctorA.rpc('search_patients', { p_clinic_id: CLINIC_B_ID, p_query: 'Priya' })
    const empty = !error && Array.isArray(data) && data.length === 0
    report('search_patients: doctor.a querying clinic B (explicit id + matching name) returns nothing', empty,
      error ? `error: ${error.message}` : `rows returned: ${data?.length ?? 'n/a'}`)
  }

  // reception.a searching within her own clinic -- "Kumar" genuinely
  // matches two real clinic A patients (Rajesh Kumar, Rajeesh Kumar), so
  // this proves scoping positively (a non-empty, correct result set), not
  // just vacuously (an empty result proves nothing about scoping).
  {
    const { data, error } = await receptionA.rpc('search_patients', { p_clinic_id: CLINIC_A_ID, p_query: 'Kumar' })
    const namesFound = !error && Array.isArray(data) ? data.map((p) => p.name) : []
    const onlyClinicA = !error && namesFound.length > 0 && !namesFound.includes('Priya Sharma')
    report('search_patients: reception.a search returns only clinic A patients', onlyClinicA,
      error ? `error: ${error.message}` : `names: ${namesFound.join(', ')}`)
  }

  // Mirrors the doctor.a adversarial check: reception.a has no role at
  // clinic B either, so the same explicit-id attempt must also fail.
  {
    const { data, error } = await receptionA.rpc('search_patients', { p_clinic_id: CLINIC_B_ID, p_query: 'Priya' })
    const empty = !error && Array.isArray(data) && data.length === 0
    report('search_patients: reception.a querying clinic B (explicit id + matching name) returns nothing', empty,
      error ? `error: ${error.message}` : `rows returned: ${data?.length ?? 'n/a'}`)
  }

  // Realtime: doctor.a subscribes to clinic B's patients; doctor.b makes a
  // legitimate write to their own clinic's own patient (a normal app-level
  // UPDATE they're entitled to, not a privileged bypass) while doctor.a
  // listens. If RLS is misapplied to realtime, doctor.a's client receives
  // the change event anyway.
  if (!doctorB) {
    report('Realtime: doctor.a subscribed to clinic B patients, doctor.b wrote to it', null,
      'skipped -- doctor.b sign-in failed, fix the password and re-run')
  } else {
    let realtimeEventReceived = false
    const channel = doctorA.channel('isolation-test-clinic-b')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'patients', filter: `clinic_id=eq.${CLINIC_B_ID}` },
        () => { realtimeEventReceived = true })

    await new Promise((resolve, reject) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') resolve()
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`realtime subscribe failed: ${status}`))
      })
    })
    await new Promise((r) => setTimeout(r, 1500)) // let the subscription settle

    const { error: writeErr } = await doctorB.from('patients')
      .update({ age: 35 })
      .eq('id', CLINIC_B_PATIENT_ID)
    if (writeErr) throw new Error(`setup write (doctor.b updating their own patient) failed: ${writeErr.message}`)

    await new Promise((r) => setTimeout(r, 3000)) // window to receive the event, if it were leaking

    report('Realtime: doctor.a subscribed to clinic B patients, doctor.b wrote to it',
      !realtimeEventReceived,
      realtimeEventReceived ? 'event WAS received -- leak' : 'no event received')

    await channel.unsubscribe()
  }

  report('Storage', null, 'not applicable -- no storage buckets exist on this project yet')
  report('Edge Functions', null, 'not applicable -- no edge functions are deployed on this project yet')

  // ================================================================
  // Boundary 2: role-within-clinic
  // ================================================================
  console.log('\n-- Boundary 2: role-within-clinic --')

  // reception.a reading patient_comments (doctor-only table)
  {
    const { data, error } = await receptionA.from('patient_comments').select('*')
    const empty = !error && Array.isArray(data) && data.length === 0
    report('reception.a reading patient_comments', empty,
      error ? `error: ${error.message}` : `rows returned: ${data?.length ?? 'n/a'}`)
  }

  // reception.a attempting to UPDATE visit_pricing -- Postgres RLS with no
  // matching policy returns "0 rows affected", not a thrown error, so the
  // real proof is a before/after read (which reception.a *can* do -- she
  // has SELECT on visit_pricing, just not UPDATE).
  {
    const before = await receptionA.from('visit_pricing')
      .select('final_amount_paise, revision_number')
      .eq('visit_id', LAKSHMI_VISIT_ID)
      .single()

    await receptionA.from('visit_pricing')
      .update({ final_amount_paise: 99999 })
      .eq('visit_id', LAKSHMI_VISIT_ID)

    const after = await receptionA.from('visit_pricing')
      .select('final_amount_paise, revision_number')
      .eq('visit_id', LAKSHMI_VISIT_ID)
      .single()

    const unchanged = before.data && after.data
      && before.data.final_amount_paise === after.data.final_amount_paise
      && before.data.revision_number === after.data.revision_number

    report('reception.a UPDATE on visit_pricing has no effect', unchanged,
      `before: ${JSON.stringify(before.data)}, after: ${JSON.stringify(after.data)}`)
  }

  // reception.a attempting to UPDATE a billed (paid) visit -- must have no
  // effect. Same before/after proof as the visit_pricing check above: RLS
  // with no matching row (stage='paid' fails her USING clause) returns "0
  // rows affected", not a thrown error.
  {
    const before = await receptionA.from('visits')
      .select('stage')
      .eq('id', MEENA_VISIT_ID)
      .single()

    await receptionA.from('visits')
      .update({ stage: 'waiting' })
      .eq('id', MEENA_VISIT_ID)

    const after = await receptionA.from('visits')
      .select('stage')
      .eq('id', MEENA_VISIT_ID)
      .single()

    const unchanged = before.data && after.data && before.data.stage === after.data.stage

    report('reception.a UPDATE on a billed (paid) visit has no effect', unchanged,
      `before: ${JSON.stringify(before.data)}, after: ${JSON.stringify(after.data)}`)
  }

  // doctor.a inserting a bill with corrects_bill_id set -- must succeed
  // (doctor authors corrections); with it null -- must fail (receptionist
  // authors original bills, not doctor).
  {
    const { error: correctionErr } = await doctorA.from('bills').insert({
      clinic_id: CLINIC_A_ID,
      visit_id: MEENA_VISIT_ID,
      final_amount_paise: 0,
      pricing_revision_at_confirm: 1,
      payment_method: 'cash',
      confirmed_by: (await doctorA.auth.getUser()).data.user.id,
      corrects_bill_id: MEENA_BILL_ID,
    })
    report('doctor.a inserting a bill with corrects_bill_id set succeeds', !correctionErr,
      correctionErr ? `error: ${correctionErr.message}` : 'inserted')

    const { error: originalErr } = await doctorA.from('bills').insert({
      clinic_id: CLINIC_A_ID,
      visit_id: MEENA_VISIT_ID,
      final_amount_paise: 0,
      pricing_revision_at_confirm: 1,
      payment_method: 'cash',
      confirmed_by: (await doctorA.auth.getUser()).data.user.id,
      corrects_bill_id: null,
    })
    report('doctor.a inserting a bill with corrects_bill_id null fails', !!originalErr,
      originalErr ? `error: ${originalErr.message}` : 'inserted -- should have been rejected')
  }

  // admin.only reading patients/visits/bills/prescriptions/patient_comments
  for (const table of ['patients', 'visits', 'bills', 'prescriptions', 'patient_comments']) {
    const { data, error } = await adminOnly.from(table).select('*')
    const empty = !error && Array.isArray(data) && data.length === 0
    report(`admin.only reading ${table}`, empty,
      error ? `error: ${error.message}` : `rows returned: ${data?.length ?? 'n/a'}`)
  }

  console.log('\n== Summary ==')
  const applicable = results.filter((r) => r.pass !== null)
  const failed = applicable.filter((r) => !r.pass)
  console.log(`${applicable.length - failed.length}/${applicable.length} checks passed`)
  if (failed.length) {
    console.log('FAILED:')
    for (const f of failed) console.log(`  - ${f.label}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('isolation test errored:', err.message)
  process.exitCode = 1
})
