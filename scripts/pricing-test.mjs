// TDD for visit_pricing arithmetic (AGENTS.md Phase 3: money touches -- tests
// before UI). Same convention as isolation-test.mjs: a plain script against
// live staging, signed in as the real roles, no framework. Run from the
// project root: node scripts/pricing-test.mjs
//
// Every expected value below is a hand-computed literal from the fixture
// prices chosen in this file, never a formula re-derived from the row being
// asserted on -- so a test can actually disagree with the code.
//
// All money is bigint paise end to end, including here: every fixture price
// is a whole-paise integer literal (25000, 15000, ...), never a rupee amount
// or anything divided/fractional. PostgREST serialises bigint as a JSON
// number, which is exact at these magnitudes -- no float ever enters this
// file.
//
// Two kinds of assertion are mixed together deliberately:
//   [existing] locks behaviour the schema already has (the check
//     constraints, the generated discount column, the revision-bump
//     trigger, reception's read-only access) -- expected to PASS before any
//     new migration.
//   [new]      exercises calculated_total_paise auto-recompute from
//     visit_procedures + prescription_items, and the clamp-on-decrease rule
//     -- expected to FAIL until that migration exists.
// Each report() call is tagged so a pre-migration run reads as "red where it
// should be red", not as a broken suite.

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
const CLINIC_A_ID = '23e03361-9d6c-49f5-83b7-ad57f4a0c5ce'

const results = []
function report(tag, label, pass, detail) {
  const tagStr = `[${tag}]`.padEnd(8)
  const passStr = pass === null ? 'N/A ' : pass ? 'PASS' : 'FAIL'
  results.push({ tag, label, pass, detail })
  console.log(`${tagStr}[${passStr}] ${label}${detail ? ' -- ' + detail : ''}`)
}

async function signIn(email, password) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { realtime: { transport: ws } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return client
}

async function readPricing(client, visitId) {
  const { data, error } = await client
    .from('visit_pricing')
    .select('calculated_total_paise, final_amount_paise, discount_paise, revision_number')
    .eq('visit_id', visitId)
    .single()
  if (error) throw new Error(`reading visit_pricing failed: ${error.message}`)
  return data
}

async function main() {
  const doctorA = await signIn('doctor.a@staging.test', userEnv.TEST_DOCTOR_A_PASSWORD)
  const receptionA = await signIn('reception.a@staging.test', userEnv.TEST_RECEPTION_A_PASSWORD)
  console.log('signed in as doctor.a, reception.a\n')

  // ================================================================
  // Fixtures -- fresh patient/visit/catalog rows, never the seeded ones
  // (isolation-test.mjs's fixture IDs are load-bearing for its own
  // assertions). Two rows per catalog so "sum of" is actually exercised,
  // not just "read one row's price".
  // ================================================================
  const stamp = Date.now()

  const { data: patient, error: patientErr } = await doctorA
    .from('patients')
    .insert({ clinic_id: CLINIC_A_ID, name: `Pricing Test Patient ${stamp}`, age: 40 })
    .select('id')
    .single()
  if (patientErr) throw new Error(`fixture: creating patient failed: ${patientErr.message}`)

  const { data: visit, error: visitErr } = await doctorA
    .from('visits')
    .insert({
      clinic_id: CLINIC_A_ID,
      patient_id: patient.id,
      arrived_at: new Date().toISOString(),
      complaint: 'pricing arithmetic test fixture',
    })
    .select('id')
    .single()
  if (visitErr) throw new Error(`fixture: creating visit failed: ${visitErr.message}`)
  const visitId = visit.id
  console.log(`fixture visit: ${visitId} (patient ${patient.id})\n`)

  const { data: procA, error: procAErr } = await doctorA
    .from('procedures')
    .insert({ clinic_id: CLINIC_A_ID, name: `Pricing test procedure A ${stamp}`, default_price_paise: 15000 })
    .select('id')
    .single()
  if (procAErr) throw new Error(`fixture: creating procedure A failed: ${procAErr.message}`)

  const { data: procB, error: procBErr } = await doctorA
    .from('procedures')
    .insert({ clinic_id: CLINIC_A_ID, name: `Pricing test procedure B ${stamp}`, default_price_paise: 6000 })
    .select('id')
    .single()
  if (procBErr) throw new Error(`fixture: creating procedure B failed: ${procBErr.message}`)

  const { data: procC, error: procCErr } = await doctorA
    .from('procedures')
    .insert({ clinic_id: CLINIC_A_ID, name: `Pricing test procedure C ${stamp}`, default_price_paise: 4000 })
    .select('id')
    .single()
  if (procCErr) throw new Error(`fixture: creating procedure C failed: ${procCErr.message}`)

  const { data: medA, error: medAErr } = await doctorA
    .from('medicines')
    .insert({ clinic_id: CLINIC_A_ID, name: `Pricing test medicine A ${stamp}`, price_paise: 8000 })
    .select('id')
    .single()
  if (medAErr) throw new Error(`fixture: creating medicine A failed: ${medAErr.message}`)

  const { data: medB, error: medBErr } = await doctorA
    .from('medicines')
    .insert({ clinic_id: CLINIC_A_ID, name: `Pricing test medicine B ${stamp}`, price_paise: 3000 })
    .select('id')
    .single()
  if (medBErr) throw new Error(`fixture: creating medicine B failed: ${medBErr.message}`)

  // ================================================================
  // A. Visit creation seeds visit_pricing at the flat consultation fee.
  // ================================================================
  {
    const p = await readPricing(doctorA, visitId)
    const ok = p.calculated_total_paise === 25000 && p.final_amount_paise === 25000
      && p.discount_paise === 0 && p.revision_number === 0
    report('existing', 'new visit seeds calculated_total=25000, final=25000, discount=0, revision=0', ok, JSON.stringify(p))
  }

  // ================================================================
  // B/C. calculated_total_paise = consultation fee + SUM(visit_procedures)
  // ================================================================
  {
    const { error } = await doctorA.from('visit_procedures').insert({
      clinic_id: CLINIC_A_ID, visit_id: visitId, procedure_id: procA.id, price_paise: 15000,
    })
    if (error) throw new Error(`step B insert failed: ${error.message}`)
    const p = await readPricing(doctorA, visitId)
    report('new', 'adding one procedure (15000) recomputes calculated_total to 40000', p.calculated_total_paise === 40000, `got ${p.calculated_total_paise}`)
  }
  {
    const { error } = await doctorA.from('visit_procedures').insert({
      clinic_id: CLINIC_A_ID, visit_id: visitId, procedure_id: procB.id, price_paise: 6000,
    })
    if (error) throw new Error(`step C insert failed: ${error.message}`)
    const p = await readPricing(doctorA, visitId)
    report('new', 'adding a second procedure (6000) sums to calculated_total 46000, not just the latest row', p.calculated_total_paise === 46000, `got ${p.calculated_total_paise}`)
  }

  // ================================================================
  // D/E. calculated_total_paise also sums prescribed medicines' catalog
  // price, one unit per prescription_item.
  // ================================================================
  const { data: prescription, error: prescriptionErr } = await doctorA
    .from('prescriptions')
    .insert({ clinic_id: CLINIC_A_ID, visit_id: visitId })
    .select('id')
    .single()
  if (prescriptionErr) throw new Error(`fixture: creating prescription failed: ${prescriptionErr.message}`)

  let itemB
  {
    const { error } = await doctorA.from('prescription_items').insert({
      clinic_id: CLINIC_A_ID, prescription_id: prescription.id, medicine_id: medA.id, duration_days: 5,
    })
    if (error) throw new Error(`step D insert failed: ${error.message}`)
    const p = await readPricing(doctorA, visitId)
    report('new', 'prescribing one medicine (8000) recomputes calculated_total to 54000', p.calculated_total_paise === 54000, `got ${p.calculated_total_paise}`)
  }
  {
    const { data, error } = await doctorA.from('prescription_items').insert({
      clinic_id: CLINIC_A_ID, prescription_id: prescription.id, medicine_id: medB.id, duration_days: 3,
    }).select('id').single()
    if (error) throw new Error(`step E insert failed: ${error.message}`)
    itemB = data
    const p = await readPricing(doctorA, visitId)
    report('new', 'prescribing a second medicine (3000) sums to calculated_total 57000, not just the latest row', p.calculated_total_paise === 57000, `got ${p.calculated_total_paise}`)
  }

  // Everything from here on assumes calculated_total_paise actually landed
  // at 57000 above. If it didn't (no recompute migration yet), the
  // remaining checks would fail for the wrong reason -- stale inputs, not
  // the behaviour they're named for -- and misreport under the wrong tag.
  // Skip them cleanly instead of producing confusing red.
  const recomputeLanded = (await readPricing(doctorA, visitId)).calculated_total_paise === 57000
  const remaining = [
    'final_amount at calculated_total (upper bound, no discount)',
    'final_amount at 0 (lower bound, full discount)',
    'final_amount at an arbitrary mid-range value',
    'final_amount above calculated_total is rejected, nothing changes',
    'writing discount_paise directly is rejected (generated column)',
    'adding a procedure (4000) while a discount is set raises calculated_total to 61000 and leaves final_amount at 20000',
    'removing a prescribed medicine (3000) recomputes calculated_total and clamps final_amount down to match',
    'reception.a can read visit_pricing and sees the same figures as doctor.a',
    'reception.a UPDATE on visit_pricing has no effect',
  ]
  if (!recomputeLanded) {
    for (const label of remaining) {
      report('new', label, null, 'skipped -- calculated_total_paise recompute has not landed yet (see the FAILs above)')
    }
  } else {
    // ================================================================
    // F/G/H. final_amount_paise: doctor-settable, anywhere from
    // calculated_total down to 0; discount is derived; every edit bumps
    // revision by exactly 1.
    // ================================================================
    async function setFinalAmount(label, value, expectedDiscount) {
      const before = await readPricing(doctorA, visitId)
      const { error } = await doctorA.from('visit_pricing').update({ final_amount_paise: value }).eq('visit_id', visitId)
      if (error) {
        report('existing', `${label}: final_amount=${value} -> discount=${expectedDiscount}, revision +1`, false, `update failed: ${error.message}`)
        return
      }
      const after = await readPricing(doctorA, visitId)
      const discountOk = after.discount_paise === expectedDiscount
      const revisionOk = after.revision_number === before.revision_number + 1
      report('existing', `${label}: final_amount=${value} -> discount=${expectedDiscount}, revision +1`,
        discountOk && revisionOk,
        `discount ${after.discount_paise} (want ${expectedDiscount}), revision ${before.revision_number} -> ${after.revision_number}`)
    }
    await setFinalAmount('final_amount at calculated_total (upper bound, no discount)', 57000, 0)
    await setFinalAmount('final_amount at 0 (lower bound, full discount)', 0, 57000)
    await setFinalAmount('final_amount at an arbitrary mid-range value', 20000, 37000)

    // ================================================================
    // I. A final amount above the calculated total is rejected outright.
    // ================================================================
    {
      const before = await readPricing(doctorA, visitId)
      const { error } = await doctorA.from('visit_pricing')
        .update({ final_amount_paise: before.calculated_total_paise + 1 })
        .eq('visit_id', visitId)
      const after = await readPricing(doctorA, visitId)
      const rejected = !!error && after.final_amount_paise === before.final_amount_paise && after.revision_number === before.revision_number
      report('existing', 'final_amount above calculated_total is rejected, nothing changes', rejected,
        error ? `error: ${error.message}` : 'no error was raised -- should have been rejected')
    }

    // ================================================================
    // J. discount_paise is derived, never directly settable.
    // ================================================================
    {
      const { error } = await doctorA.from('visit_pricing').update({ discount_paise: 1 }).eq('visit_id', visitId)
      report('existing', 'writing discount_paise directly is rejected (generated column)', !!error,
        error ? `error: ${error.message}` : 'no error was raised -- should have been rejected')
    }

    // ================================================================
    // The other half of the clamp decision: an INCREASE to
    // calculated_total (adding a procedure) must never touch an
    // already-set final_amount, only a decrease clamps it.
    // final_amount is currently 20000 against a total of 57000 (a real
    // discount, not final == total) -- the case the clamp must leave alone.
    // ================================================================
    {
      const before = await readPricing(doctorA, visitId)
      const { error } = await doctorA.from('visit_procedures').insert({
        clinic_id: CLINIC_A_ID, visit_id: visitId, procedure_id: procC.id, price_paise: 4000,
      })
      if (error) throw new Error(`increase-while-discounted insert failed: ${error.message}`)
      const after = await readPricing(doctorA, visitId)
      const ok = after.calculated_total_paise === 61000 && after.final_amount_paise === 20000
        && after.discount_paise === 41000 && after.revision_number === before.revision_number + 1
      report('new', 'adding a procedure (4000) while a discount is set raises calculated_total to 61000 and leaves final_amount at 20000', ok, JSON.stringify(after))
    }

    // ================================================================
    // K/L. Removing a procedure/medicine lowers calculated_total; if that
    // drops below the doctor's already-set final_amount, final_amount is
    // clamped down to the new total rather than violating the constraint.
    // ================================================================
    {
      const current = await readPricing(doctorA, visitId)
      await setFinalAmount('final_amount raised back to calculated_total, to set up the clamp test', current.calculated_total_paise, 0)
    }
    {
      const { error } = await doctorA.from('prescription_items').delete().eq('id', itemB.id)
      if (error) throw new Error(`step L delete failed: ${error.message}`)
      const p = await readPricing(doctorA, visitId)
      const ok = p.calculated_total_paise === 58000 && p.final_amount_paise === 58000 && p.discount_paise === 0
      report('new', 'removing a prescribed medicine (3000) recomputes calculated_total and clamps final_amount down to match', ok, JSON.stringify(p))
    }

    // ================================================================
    // M/N. reception.a can read the amount, and cannot change it.
    // ================================================================
    {
      const p = await readPricing(receptionA, visitId)
      const ok = p.calculated_total_paise === 58000 && p.final_amount_paise === 58000
      report('existing', 'reception.a can read visit_pricing and sees the same figures as doctor.a', ok, JSON.stringify(p))
    }
    {
      const before = await readPricing(receptionA, visitId)
      await receptionA.from('visit_pricing').update({ final_amount_paise: 1 }).eq('visit_id', visitId)
      const after = await readPricing(receptionA, visitId)
      const unchanged = before.final_amount_paise === after.final_amount_paise && before.revision_number === after.revision_number
      report('existing', 'reception.a UPDATE on visit_pricing has no effect', unchanged,
        `before: ${JSON.stringify(before)}, after: ${JSON.stringify(after)}`)
    }
  }

  console.log('\n== Summary ==')
  for (const tag of ['existing', 'new']) {
    const inTag = results.filter((r) => r.tag === tag && r.pass !== null)
    const failed = inTag.filter((r) => !r.pass)
    const skipped = results.filter((r) => r.tag === tag && r.pass === null).length
    console.log(`${tag}: ${inTag.length - failed.length}/${inTag.length} passed${skipped ? `, ${skipped} skipped` : ''}`)
    if (failed.length) for (const f of failed) console.log(`  FAIL - ${f.label}`)
  }
  if (results.some((r) => r.pass === false)) process.exitCode = 1
}

main().catch((err) => {
  console.error('pricing test errored:', err.message)
  process.exitCode = 1
})
