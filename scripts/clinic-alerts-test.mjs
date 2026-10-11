import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const stored=new Map();let tail=Promise.resolve()
function load(path){const exports={};const context=vm.createContext({exports,Date,Intl,Map,Set,require:()=>({update:(key,fn)=>{tail=tail.then(()=>stored.set(key,fn(stored.get(key))));return tail}})});vm.runInContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return exports}
const {buildClinicAlerts,reconcileAlerts}=load('src/lib/clinicAlerts.ts')
const now=Date.parse('2026-10-11T10:30:00Z'),today='2026-10-10T18:30:00Z'
const visit=(id,stage,extra={})=>({id,stage,patient_id:id,token_number:1,arrived_at:today,called_at:null,not_here_at:null,discount_requested_at:null,...extra})
const source={visits:[visit('call','called',{called_at:new Date(now-5*60000).toISOString()}),visit('absent','not_here',{not_here_at:new Date(now-30*60000).toISOString()}),visit('bill','ready_to_bill',{discount_requested_at:new Date(now).toISOString()}),visit('sent','with_doctor'),visit('duplicate-a','waiting',{patient_id:'same'}),visit('duplicate-b','waiting',{patient_id:'same'})],medicines:[{id:'m',name:'Synthetic medicine',low_stock_threshold:5,expiry_date:'2026-10-12'}],stock:[{medicine_id:'m',quantity:3}],noShowMinutes:30,shortfalls:[{bill_id:'b',shortfall:2,bills:{visit_id:'bill',visits:{patient_id:'bill',token_number:1}}}]}
const ids=rows=>Array.from(rows,a=>a.id)
const reception=buildClinicAlerts(source,false,now,today),doctor=buildClinicAlerts(source,true,now,today)
for(const id of ['called:call','sent-reminder:call','no-show:absent','bill:bill','duplicate:duplicate-a','stock:m','closing:'+today])assert.ok(ids(reception).includes(id),id)
assert.ok(!ids(reception).includes('discount:bill'));assert.ok(!ids(reception).includes('shortfall:b'));assert.ok(ids(doctor).includes('discount:bill'));assert.ok(ids(doctor).includes('shortfall:b'));assert.ok(ids(doctor).includes('sent:sent'))
assert.equal(reception.filter(a=>a.id==='stock:m').length,1,'Stock warnings grouped per medicine')
assert.ok(!ids(buildClinicAlerts(source,false,now-1,today)).includes('closing:'+today),'4 PM boundary in IST')
assert.ok(!ids(buildClinicAlerts({...source,visits:[visit('new','called',{called_at:new Date(now-299999).toISOString()})]},false,now,today)).includes('sent-reminder:new'))
let recent=reconcileAlerts([],reception,new Date(now).toISOString());recent[0].read=true;recent[0].dismissed=true
recent=reconcileAlerts(recent,reception,new Date(now+1).toISOString());assert.equal(recent[0].read,true);assert.equal(recent[0].dismissed,true)
const resolved=reconcileAlerts(recent,[],new Date(now+2).toISOString());assert.ok(resolved.every(a=>a.resolvedAt));assert.equal(resolved.length,recent.length)
const reopened=reconcileAlerts(resolved,reception,new Date(now+3).toISOString());assert.equal(reopened[0].read,false);assert.equal(reopened[0].dismissed,false)
assert.equal(reconcileAlerts([],Array.from({length:1005},(_,i)=>({...reception[0],id:'large:'+i})),new Date(now).toISOString()).length,1005,'Active alerts are never dropped by history retention')
const {freshCall,consumeCall}=load('src/lib/callSound.ts');const event={id:'one',action:'call',created_at:new Date(now-100).toISOString()}
assert.ok(freshCall(event,now-200,now));assert.equal(freshCall(event,now,now),false);assert.equal(freshCall({...event,action:'finish'},now-200,now),false);assert.equal(freshCall(event,0,now+10000),false)
assert.deepEqual(await Promise.all([consumeCall('clinic-a:user-a','one'),consumeCall('clinic-a:user-a','one')]),[true,false]);assert.equal(await consumeCall('clinic-b:user-a','one'),true)
assert.equal(await load('src/lib/callSound.ts').consumeCall('clinic-a:user-a','one'),false,'Reload cannot replay the same call')
console.log('PASS: role-aware alerts, five-minute/4 PM IST boundaries, no-show, duplicates, stock grouping, shortfalls, resolution history and atomic reload-safe chime deduplication')
