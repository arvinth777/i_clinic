import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
const require=createRequire(import.meta.url),queries=[],filters=[],money={}
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/money.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:money})
const bill={bill_id:'outside-first-page',visit_id:'v',final_amount_paise:25000,confirmed_at:'2026-10-17T00:00:00Z',token_number:77,arrived_at:'2026-10-17T00:00:00Z',patient_name:'SYNTHETIC target outside list'}
const chain={select(){return this},eq(column,value){filters.push([column,value]);return this},maybeSingle:async()=>({data:bill,error:null})}
function loadTarget(fetching=false,cached=false){
 const exports={}
 vm.runInNewContext(ts.transpileModule(readFileSync('src/pages/UnpaidBills.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:name=>{
  if(name==='@tanstack/react-query')return{useQueryClient:()=>({invalidateQueries(){}}),useQuery:options=>{queries.push(options);return{data:options.queryKey[0]==='unpaid-bill-target'?bill:[],dataUpdatedAt:cached?0:Date.now()+100,isFetching:options.queryKey[0]==='unpaid-bill-target'&&fetching,isError:false,isPending:false}},useMutation:()=>({isPending:false})}
  if(name.endsWith('/supabase'))return{supabase:{from:()=>chain}}
  if(name.endsWith('/money'))return money
  if(name.endsWith('/date'))return{formatDate:()=> '17 Oct 2026'}
  if(name.includes('/components/'))return new Proxy({},{get:(_t,key)=>props=>React.createElement(key==='Input'?'input':'div',props,props.children)})
  return require(name)
 }})
 return exports.UnpaidBills
}
const html=renderToStaticMarkup(React.createElement(loadTarget(),{clinicId:'clinic',initialBillId:bill.bill_id}))
assert.match(html,/Collect payment/);assert.match(html,/SYNTHETIC target outside list/,'target is shown even when the list page is empty')
await queries.find(q=>q.queryKey[0]==='unpaid-bill-target').queryFn()
assert.deepEqual(filters,[['clinic_id','clinic'],['bill_id',bill.bill_id]])
const pending=renderToStaticMarkup(React.createElement(loadTarget(true,true),{clinicId:'clinic',initialBillId:bill.bill_id}))
assert.ok(!pending.includes('Collect payment'),'cached settlement form is hidden until the target is refreshed')
const background=renderToStaticMarkup(React.createElement(loadTarget(true),{clinicId:'clinic',initialBillId:bill.bill_id}))
assert.match(background,/Collect payment/,'a background refresh preserves the mounted form')
console.log('PASS: bill outside first list page opens via a clinic-scoped read; cached target waits for validation')
