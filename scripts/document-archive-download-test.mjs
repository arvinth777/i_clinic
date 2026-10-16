import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const code=ts.transpileModule(readFileSync('src/components/DocumentArchives.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
let layout,clicked=0,resolveSession,sessionCalls=0,pauseFinal=false
const version={current:0},session={user:{id:'owner'}},job={id:'receipt',kind:'receipt',status:'ready',created_at:'2026-10-17'}
const context={exports:{},URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL:()=>{}},document:{createElement:()=>({click:()=>clicked++})},setTimeout:()=>{},console,require(name){
 if(name.endsWith('.css'))return{}
 if(name==='react')return{useState:initial=>[initial,()=>{}],useRef:()=>version,useEffect:()=>{},useLayoutEffect:fn=>{layout=fn}}
 if(name==='react/jsx-runtime')return{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}
 if(name==='@tanstack/react-query')return{useQuery:()=>({data:[job],isError:false})}
 if(name==='idb-keyval')return{createStore:()=>({})}
 if(name==='../lib/supabase')return{supabase:{auth:{getSession:async()=>{sessionCalls++;if(pauseFinal&&sessionCalls===2)return new Promise(resolve=>{resolveSession=resolve});return{data:{session}}}}}}
 if(name==='../lib/patientDocuments')return{documentRequest:async()=>new Blob(['%PDF-1.4'])}
 if(name==='../lib/pinLock')return{isScreenLocked:()=>false}
 if(name==='../lib/date')return{formatDate:v=>v}
 throw new Error(`Unexpected ${name}`)
}}
vm.runInNewContext(code,context)
function button(node){if(!node||typeof node!=='object')return; if(node.type==='button'&&node.props.children==='Download PDF')return node;for(const child of [node.props?.children].flat(Infinity)){const result=button(child);if(result)return result}}
function render(){const tree=context.exports.DocumentArchives({clinicId:'clinic',billId:'bill'});return{open:button(tree).props.onClick,cleanup:layout()}}
let view=render();view.open();await new Promise(resolve=>setImmediate(resolve));assert.equal(clicked,1,'normal download completes');view.cleanup()
sessionCalls=0;pauseFinal=true;view=render();const pending=view.open();while(!resolveSession)await new Promise(resolve=>setImmediate(resolve))
view.cleanup();layout() // lock and unlock or unmount/remount while the final auth check is pending
resolveSession({data:{session}});await pending;await new Promise(resolve=>setImmediate(resolve))
assert.equal(clicked,1,'late response never downloads across a lock cycle or unmount')
console.log('PASS: normal archive download, delayed final-auth response cancelled by lock/unmount generation')
