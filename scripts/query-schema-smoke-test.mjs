// Every table query in the app must be valid against the real schema.
// Finds each `.from('table')` chain in src (or the dir given as argv[2]), collects the select string and every column
// used in filters/ordering, and runs it on STAGING with zero rows (.limit(0)): checks names only, reads/writes no data.
// Fails on unknown column / table / relationship. Permission and type errors are ignored (RLS and dummy values).
// Run from the project root: node scripts/query-schema-smoke-test.mjs
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
const env = p => Object.fromEntries(readFileSync(p,'utf8').split('\n').filter(l=>l.trim()&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')).trim(),l.slice(l.indexOf('=')+1).trim()]))
const a=env('.env.local'),pw=env('.env.test-users.local')
assert.equal(new URL(a.VITE_SUPABASE_URL).hostname,'cofnrcgsolluyhghutah.supabase.co')
const files=d=>readdirSync(d).flatMap(n=>{const p=join(d,n);return statSync(p).isDirectory()?files(p):/\.tsx?$/.test(p)?[p]:[]})
const root=process.argv[2]??'src'
const queries=[]
for(const file of files(root)){
  const lines=readFileSync(file,'utf8').split('\n')
  lines.forEach((line,i)=>{
    for(const m of line.matchAll(/\.from\(\s*['"]([a-z_]+)['"]\s*\)/g)){
      // the chain is this line from the match on, plus following lines that begin with `.`
      let chain=line.slice(m.index+m[0].length), j=i+1
      while(j<lines.length&&/^\s*\./.test(lines[j])) chain+='\n'+lines[j++]
      const sel=chain.match(/^\s*\.select\(\s*(['"`])((?:(?!\1)[^\\])*)\1/)
      const cols=[...chain.matchAll(/\.(?:eq|neq|gt|gte|lt|lte|in|is|like|ilike|not|order)\(\s*['"]([a-z_]+)['"]/g)].map(x=>x[1])
      if(sel?.[2].includes('${'))continue
      if(sel||cols.length)queries.push({table:m[1],select:sel?.[2]??null,cols:[...new Set(cols)],where:`${file}:${i+1}`})
    }
  })
}
const login=async(e,p)=>{const c=createClient(a.VITE_SUPABASE_URL,a.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false},realtime:{transport:ws}});assert.ifError((await c.auth.signInWithPassword({email:e,password:p})).error);return c}
const clients=[await login('doctor.a@staging.test',pw.TEST_DOCTOR_A_PASSWORD),await login('reception.a@staging.test',pw.TEST_RECEPTION_A_PASSWORD)]
const SCHEMA_ERRORS=new Set(['42703','42P01','PGRST200','PGRST201','PGRST204','PGRST100'])
const failures=[]
for(const q of queries){
  let result
  for(const c of clients){
    let b=c.from(q.table).select(q.select??'*').limit(0)
    for(const col of q.cols) b=b.is(col,null)   // is.null is valid for any column type: checks the name only
    result=await b
    if(!result.error||SCHEMA_ERRORS.has(result.error.code))break   // try the next role only on permission errors
  }
  if(result.error&&SCHEMA_ERRORS.has(result.error.code))failures.push(`${q.where}  ${q.table}: ${result.error.message}`)
}
console.log(`${queries.length} table queries checked in ${root}`)
if(failures.length){console.log('FAIL:');failures.forEach(f=>console.log('  '+f));process.exit(1)}
console.log('PASS: every table query matches the staging schema')
process.exit(0)
