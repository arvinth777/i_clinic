import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Fresh routes must not depend on visiting another lazy page for their CSS.
const entry = readFileSync('dist/index.html', 'utf8')
const initialCss = [...entry.matchAll(/href="([^"]+\.css)"/g)]
  .map(match => readFileSync(`dist${match[1]}`, 'utf8')).join('\n')
for (const selector of ['.patients-workspace', '.patient-record', '.flow-stats', '.drive-callback-result']) {
  assert.ok(initialCss.includes(selector), `${selector} is available on the first load`)
}

const require = createRequire(import.meta.url)
const exports = {}
const context = vm.createContext({
  exports, URLSearchParams,
  window: { location: { search: '', pathname: '/' } },
  require: name => {
    if (name.endsWith('.css') || name.includes('/lib/')) return {}
    if (name === './ui/button') return { Button: ({ children }) => React.createElement('button', {}, children) }
    return require(name)
  },
})
vm.runInContext(ts.transpileModule(readFileSync('src/components/DriveCallback.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, context)
for (const [props, title, role, button] of [
  [{ status: 'Waiting for Google', done: false }, 'Connecting Google Drive…', 'status', false],
  [{ status: 'Ready to upload', done: true }, 'Google Drive connected', 'status', true],
  [{ status: 'Access was not approved', done: true, failed: true }, 'Connection not completed', 'alert', true],
]) {
  const html = renderToStaticMarkup(React.createElement(exports.DriveConnectionResult, props))
  assert.ok(html.includes(title))
  assert.ok(html.includes(`role="${role}"`))
  assert.equal(html.includes('Return to clinic'), button)
}
console.log('PASS: initial-route CSS and Drive loading, success and error views')
