import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { attemptOrQueue } from '../../lib/offlineQueue'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { LoadingRows, QueryError } from '../QueryState'
export function QueueSettings({clinicId}:{clinicId:string}) {
  const client=useQueryClient(), key=['queue-settings',clinicId]
  const [draft,setDraft]=useState('')
  const query=useQuery({queryKey:key,queryFn:async()=>{const {data,error}=await supabase.from('clinics').select('no_show_minutes').eq('id',clinicId).single();if(error)throw error;return data}})
  const save=useMutation({networkMode:'always',mutationFn:async()=>{
    const minutes=Number(draft || query.data?.no_show_minutes)
    if(!Number.isInteger(minutes)||minutes<1||minutes>240)throw new Error('Use a whole number from 1 to 240 minutes.')
    const args={p_clinic_id:clinicId,p_minutes:minutes}
    await attemptOrQueue({clinicId,attempt:token=>supabase.rpc('set_no_show_minutes',args).setHeader('Authorization',`Bearer ${token}`),queueItem:()=>({kind:'rpc',rpc:'set_no_show_minutes',payload:args,description:'Change no-show reminder time'}),applyOptimistic:()=>client.setQueryData(key,{no_show_minutes:minutes})})
  },onSuccess:()=>{void client.invalidateQueries({queryKey:key});setDraft('')}})
  return <section><h2>Queue settings</h2><p className="field-hint">Reception gets a reminder after this time. Patients are never removed automatically.</p>
    {query.isError && <QueryError retry={()=>void query.refetch()} savedAt={query.dataUpdatedAt} />}
    {query.isPending ? <LoadingRows label="Loading settings…"/> : <form onSubmit={e=>{e.preventDefault();save.mutate()}}><div className="field"><label className="field-label" htmlFor="no-show-minutes">No-show reminder (minutes)</label><Input id="no-show-minutes" type="number" min={1} max={240} step={1} value={draft || query.data?.no_show_minutes || 30} onChange={e=>setDraft(e.target.value)}/></div><Button disabled={save.isPending} type="submit">Save</Button></form>}
    {save.isError && <p className="form-error">{save.error.message}</p>}
  </section>
}
