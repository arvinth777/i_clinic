import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
let state = [], index = 0
const visit = { id:'visit', patient_id:'patient', arrived_at:new Date().toISOString(), stage:'ready_to_bill', discount_requested_at:new Date().toISOString(), token_number:1, patients:{name:'SYNTHETIC patient'} }
const component = name => Object.assign(()=>null,{displayName:name})
const modules = new Map()
function dependency(path) {
 if(path==='react') return {useState:initial=>{const i=index++;if(!(i in state))state[i]=initial;return[state[i],value=>{state[i]=value}]},useRef:()=>({current:null}),useEffect:()=>{}}
 if(path==='react/jsx-runtime') return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}
 if(path==='@tanstack/react-query') return {useQueryClient:()=>({}),useInfiniteQuery:()=>({data:{pages:[]}}),useMutation:()=>({}),useQuery:({queryKey})=>({data:queryKey[0]==='doctor-queue'?[visit]:undefined})}
 if(path.endsWith('useClinicId'))return{useClinicId:()=>({data:'clinic'})}
 if(path.endsWith('queueActions'))return{useQueueAction:()=>({})}
 if(path.endsWith('useVisitProcedures'))return{useVisitProcedures:()=>({})}
 if(path.endsWith('realtimeStatus'))return{useQueuePollInterval:()=>30000}
 if(path.endsWith('date'))return{startOfToday:()=>new Date().toISOString().slice(0,10),elapsedMinutes:()=>0,formatElapsed:()=>''}
 if(path.endsWith('patientBody'))return{formatBody:()=>''}
 if(!modules.has(path)) modules.set(path,new Proxy({},{get:(_target,name)=>component(name)}))
 return modules.get(path)
}
const code=ts.transpileModule(readFileSync('src/pages/Consultation.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
const context={exports:{},require:dependency,Date};vm.runInNewContext(code,context)
const walk=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(walk)]
function render(){index=0;return walk(context.exports.Consultation({userId:'owner',onOpenPatient:()=>{}}))}
// The "View prescription" button lives in the DoctorOverview component; its onViewPrescription is what the button calls.
let tree=render();const overview=tree.find(node=>node.type?.displayName==='DoctorOverview');assert.ok(overview&&overview.props.sent,'a finished visit shows the overview in its sent state');overview.props.onViewPrescription()
tree=render();assert.ok(tree.some(node=>node.type?.displayName==='IssuedPrescription'),'View prescription must mount the read-only issued prescription, not Billing')
assert.ok(!tree.some(node=>node.type?.displayName==='Billing'),'Prescription view must not mount payment UI')
console.log('PASS: completed consultation opens issued prescription rather than billing')
// Exercise the actual viewer query: online snapshot is saved under owner/clinic/visit,
// and offline rendering uses that persisted snapshot without a network dependency.
let queries=[],saved
const snapshot={visit,clinic:{name:'SYNTHETIC clinic'},medicines:[{kind:'medicine',description:'SYNTHETIC medicine'}],prescriptionIds:[]}
const viewerContext={exports:{},Set,require(path){
 if(path==='@tanstack/react-query')return{useQuery:options=>{queries.push(options);return options.queryKey[0]==='prescription-print'?{data:snapshot,isSuccess:true}:{}}}
 if(path.endsWith('prescriptionPrint'))return{readPrescriptionPrint:async()=>snapshot,savePrescriptionPrint:async(...args)=>{saved=args}}
 if(path.endsWith('usePrintDocument'))return{usePrintDocument:()=>({mutate(){}})}
 if(path.endsWith('supabase'))return{supabase:{from:table=>({select:()=>({eq(){return this},single:async()=>({data:table==='visits'?visit:snapshot.clinic}),order:async()=>({data:[{id:'rx',diagnosis:'SYNTHETIC diagnosis',advice:'SYNTHETIC advice'}]})})}),rpc:async()=>({data:snapshot.medicines})}}
 return dependency(path)
}}
const viewerCode=ts.transpileModule(readFileSync('src/components/IssuedPrescription.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
vm.runInNewContext(viewerCode,viewerContext)
const view=walk(viewerContext.exports.IssuedPrescription({userId:'owner',clinicId:'clinic',visitId:'visit'}))
assert.ok(view.some(node=>[].concat(node.props?.children ?? []).includes('Print prescription')),'offline saved snapshot still offers printing')
assert.equal(queries[0].networkMode,'always','IndexedDB reads must work offline')
assert.equal(queries[1].enabled,false,'existing issued snapshot must not be replaced after catalog edits');
const loaded=await queries[1].queryFn();assert.equal(loaded.visit.diagnosis,'SYNTHETIC diagnosis');assert.equal(loaded.visit.advice,'SYNTHETIC advice')
assert.equal(saved[0],'owner');assert.equal(saved[1],'clinic');assert.equal(saved[2].visit.id,'visit');assert.equal(saved[2].medicines.length,1)
console.log('PASS: persisted offline print and online clinical fields, scoped to owner/clinic/visit')

snapshot.medicines=[];await assert.rejects(queries[1].queryFn(),/issued prescription copy is not available/);console.log('PASS: missing medicine lines cannot be mistaken for an issued prescription')
