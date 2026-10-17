// Pure-logic test for amountInWords (receipts). No database.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import ts from 'typescript'
const { outputText } = ts.transpileModule(readFileSync(new URL('../src/lib/money.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } })
const { amountInWords } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'))
const cases = [[0, 'Rupees Zero Only'], [100, 'Rupees One Only'], [29000, 'Rupees Two Hundred Ninety Only'], [25050, 'Rupees Two Hundred Fifty and Fifty Paise Only'], [100000, 'Rupees One Thousand Only'],
  [1234500, 'Rupees Twelve Thousand Three Hundred Forty Five Only'], [10000000, 'Rupees One Lakh Only'], [123456700, 'Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only'], [1900, 'Rupees Nineteen Only'], [5, 'Rupees Zero and Five Paise Only'], [100000000, 'Rupees Ten Lakh Only'], [1000000000, 'Rupees One Crore Only']]
for (const [paise, words] of cases) assert.equal(amountInWords(paise), words, `${paise} paise`)
console.log('PASS: amounts are written in words with Indian grouping')
