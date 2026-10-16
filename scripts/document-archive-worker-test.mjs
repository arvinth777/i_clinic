import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const code=ts.transpileModule(readFileSync('src/components/DocumentArchives.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
let effect,dependencies,invalidated=[],attempted=[],fail=true,done
const completed=()=>new Promise(resolve=>{done=resolve})
const jobs=[{id:'bad',kind:'prescription'},{id:'good',kind:'receipt'}],blob=new Blob(['%PDF-1.4'])
const context={exports:{},navigator:{onLine:true},FormData,Blob,Error,console,setTimeout,URL,require(name){
 if(name.endsWith('.css'))return{}
 if(name==='react')return{useEffect:(fn,deps)=>{effect=fn;dependencies=deps},useState:()=>['',()=>{}],useRef:()=>({current:0}),useLayoutEffect:()=>{}}
 if(name==='react/jsx-runtime')return{jsx:()=>null,jsxs:()=>null}
 if(name==='@tanstack/react-query')return{useQuery:()=>({data:jobs,dataUpdatedAt:2,isError:false}),useQueryClient:()=>({invalidateQueries:({queryKey})=>{invalidated.push(queryKey);if(queryKey[0]==='pending-archives')done?.();return Promise.resolve()}})}
 if(name==='idb-keyval')return{createStore:()=>({}),get:async()=>blob,set:async()=>{},del:async()=>{}}
 if(name==='../lib/supabase')return{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'owner'},access_token:'synthetic'}}})}}}
 if(name==='../lib/patientDocuments')return{documentRequest:async(_action,form)=>{const id=JSON.parse(form.get('metadata')).id;attempted.push(id);if(id==='bad'&&fail)throw new Error('Permanent synthetic failure')}}
 if(name==='../lib/pinLock')return{isScreenLocked:()=>false}
 if(name==='../lib/date')return{formatDate:v=>v}
 throw new Error(`Unexpected module ${name}`)
}}
vm.runInNewContext(code,context)
context.exports.ArchiveWorker({clinicId:'clinic',ownerId:'owner',locked:false})
assert.ok(dependencies.includes(2),'unchanged job rows still retry on a successful query refresh')
let promise=completed();let cleanup=effect();await promise;cleanup()
assert.deepEqual(attempted,['bad','good'],'one bad job cannot block unrelated valid receipt')
fail=false;attempted=[];invalidated=[]
promise=completed();cleanup=effect();await promise;cleanup()
assert.deepEqual(attempted,['bad','good'],'same pending list retries after Drive is restored')
assert.ok(invalidated.some(key=>key[0]==='pending-archives'))
console.log('PASS: poison job isolation, unchanged-data refresh retry and successful queue invalidation')
