import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
let releaseFont
let prints=0
const fontReady=new Promise(resolve=>{releaseFont=resolve})
const document={fonts:[{load:()=>fontReady}]}
document.fonts.ready=Promise.resolve()
const exports={}
const active={current:null}
let cleanup
const react={useRef:()=>active,useLayoutEffect:fn=>{cleanup=fn()}}
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/usePrintDocument.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>name==='react'?react:{useMutation:options=>options},document,window:{print:()=>{prints++}}})
const options=exports.usePrintDocument('patient-A')
assert.equal(options.networkMode,'always','cached offline printing must not be paused by React Query')
const pending=options.mutationFn('patient-A')
await Promise.resolve()
assert.equal(prints,0,'never snapshot an invisible block font before it is ready')
releaseFont()
await pending
assert.equal(prints,1)
document.fonts[0].load=async()=>{throw new Error('Unavailable')}
await assert.rejects(options.mutationFn('patient-A'),/Print fonts are unavailable/)
assert.equal(prints,1,'missing assets must surface an error instead of printing an incomplete letterhead')
document.fonts[0].load=()=>new Promise(resolve=>{releaseFont=resolve})
const switched=options.mutationFn('patient-A')
active.current='patient-B'
releaseFont()
await switched
assert.equal(prints,1,'switching documents cancels pending printing')
active.current='patient-A'
const unmounted=options.mutationFn('patient-A')
cleanup()
releaseFont()
await unmounted
assert.equal(prints,1,'unmounting cancels pending printing')
await options.mutationFn('patient-A')
assert.equal(prints,1,'a deferred callback cannot print after unmount')
console.log('PASS: print waits for hidden fonts, works offline, reports unavailable assets, and cancels after navigation')
