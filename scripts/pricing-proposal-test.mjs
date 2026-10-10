import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'
const exports={};vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/pricingProposal.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports})
const base={lines:[{kind:'consultation',quantity:1,unit_price_paise:25000}],total_paise:25000,revision_number:2}
const added=exports.changeProposal(base,lines=>[...lines,{kind:'medicine',prescription_item_id:'item',quantity:3,unit_price_paise:1001}])
assert.equal(added.total_paise,28003);assert.equal(base.total_paise,25000)
assert.equal(exports.changeProposal(added,lines=>[...lines,{kind:'procedure',quantity:1,unit_price_paise:500}]).total_paise,28503)
assert.equal(exports.changeProposal(base,lines=>[...lines,{kind:'medicine',quantity:3,unit_price_paise:NaN}]),undefined)
assert.equal(exports.changeProposal(base,()=>[{kind:'medicine',quantity:3,unit_price_paise:Number.MAX_SAFE_INTEGER}]),undefined)
console.log('PASS: local reviewed lines retain integer paise; uncached prices and unsafe totals cannot be approved')
