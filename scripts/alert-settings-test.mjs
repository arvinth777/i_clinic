import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/clinicAlerts.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Date,Intl,Map,Set})
const {buildClinicAlerts}=exports
const now=Date.parse('2026-10-17T10:15:00Z'),today='2026-10-16T18:30:00Z'
const visit={id:'v',patient_id:'p',token_number:12,stage:'called',arrived_at:today,called_at:new Date(now-4*60000).toISOString(),not_here_at:null,discount_requested_at:null}
const source={visits:[visit],medicines:[],stock:[],shortfalls:[],noShowMinutes:30,calledReminderMinutes:3,closingMinute:945,unpaidBills:[{bill_id:'b',visit_id:'v',token_number:12,final_amount_paise:25000}]}
const rows=buildClinicAlerts(source,false,now,today)
assert.ok(rows.some(r=>r.id==='sent-reminder:v'),'configured called delay is used')
assert.ok(rows.some(r=>r.id==='closing:'+today),'closing uses minute-precision IST, not device time')
assert.ok(rows.some(r=>r.id==='unpaid:b'&&r.section==='unpaid'&&r.billId==='b'),'each unpaid bill has its own settlement target')
assert.ok(!buildClinicAlerts({...source,closingMinute:946},false,now,today).some(r=>r.id.startsWith('closing:')))
assert.ok(!buildClinicAlerts({...source,calledReminderMinutes:5},false,now,today).some(r=>r.id==='sent-reminder:v'))
assert.ok(!buildClinicAlerts(source,true,now,today).some(r=>r.section==='unpaid'),'doctor cannot open reception-only settlement')
console.log('PASS: configurable timing, IST minute boundaries and individual unpaid targets')
