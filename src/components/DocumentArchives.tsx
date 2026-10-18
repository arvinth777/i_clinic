import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createStore, get, set, del } from 'idb-keyval'
import { supabase } from '../lib/supabase'
import { documentRequest } from '../lib/patientDocuments'
import { formatDate } from '../lib/date'
import { isScreenLocked } from '../lib/pinLock'
import { LoadingRows } from './QueryState'
import './PatientDocuments.css'
import './OfflineQueueBanner.css'
import type { ArchiveSnapshot } from '../lib/documentArchivePdf'

type Archive = { id: string; kind: 'prescription' | 'receipt'; status: string; created_at: string; last_error: string | null }
const store = createStore('clinic-document-archives', 'pdfs')
let working = false

export function ArchiveWorker({clinicId,ownerId,locked}:{clinicId:string;ownerId:string;locked:boolean}) {
  const client=useQueryClient(), [error,setError]=useState('')
  const [completed,setCompleted]=useState<string[]>([])
  const query=useQuery({queryKey:['pending-archives',clinicId,ownerId],enabled:!locked,refetchInterval:30_000,queryFn:async()=>{
    const jobs:Archive[]=[]
    for(let offset=0;;offset+=50){
      const {data,error}=await supabase.from('document_archives').select('id,kind,status,created_at,last_error').eq('clinic_id',clinicId).eq('status','pending').order('created_at').order('id').range(offset,offset+49)
      if(error)throw error
      jobs.push(...data as Archive[]);if(data.length<50)return jobs
    }
  }})
  useEffect(()=>{
    let active=true
    const current=async()=>{const {data:{session}}=await supabase.auth.getSession();return active && !locked && !isScreenLocked() && session?.user.id===ownerId}
    async function drain(){
      if(working || !navigator.onLine || !query.data?.length || !await current())return
      working=true;let uploaded=false
      try{
        for(const job of query.data){
          if(!await current())return
          const key=`${ownerId}:${clinicId}:${job.id}`
          try{
            let blob=await get<Blob>(key,store)
            if(!blob){
              const {data,error}=await supabase.from('document_archives').select('snapshot').eq('id',job.id).eq('clinic_id',clinicId).eq('status','pending').maybeSingle()
              if(error)throw error
              if(!data)continue
              const {renderArchivePdf}=await import('../lib/documentArchivePdf')
              blob=await renderArchivePdf(data.snapshot as ArchiveSnapshot)
              if(!await current())return
              await set(key,blob,store)
            }
            if(!await current())return
            const session=(await supabase.auth.getSession()).data.session
            if(!active || locked || isScreenLocked() || session?.user.id!==ownerId)return
            const form=new FormData();form.set('metadata',JSON.stringify({id:job.id,clinic_id:clinicId}));form.set('file',blob,'archive.pdf')
            await documentRequest('archive-upload',form,session.access_token)
            await del(key,store);uploaded=true
            if(active)setCompleted(ids=>[...ids,job.id])
            if(!await current())return
            void client.invalidateQueries({queryKey:['document-archives']})
          }catch(failure){if(active)setError(failure instanceof Error ? `${job.kind} ${job.id}: ${failure.message}` : 'PDF archive pending. Retry when connected.')}
        }
        if(active && uploaded)void client.invalidateQueries({queryKey:['pending-archives',clinicId,ownerId]})
      }finally{working=false}
    }
    void drain();return()=>{active=false}
  },[clinicId,ownerId,locked,query.data,query.dataUpdatedAt,client])
  if(locked)return null
  if(query.isError)return <div className="offline-queue-banner offline-queue-banner-halted" role="alert">Could not check PDF archive status. Issued records and printing still work. <button className="ui-button ui-button-neutral" type="button" onClick={()=>void query.refetch()}>Try again</button></div>
  const remaining=query.data?.filter(job=>!completed.includes(job.id)).length??0
  if(!remaining)return null
  return <div className="offline-queue-banner offline-queue-banner-pending" role="status" title={error || undefined}><span>{remaining} {remaining === 1 ? 'PDF has' : 'PDFs have'} not reached Google Drive yet. It keeps retrying on its own. Prescriptions, payments and printing are not affected.</span><button className="ui-button ui-button-neutral" type="button" onClick={()=>void query.refetch()}>Try now</button></div>
}

export function DocumentArchives({clinicId,patientId,billId,locked=false}:{clinicId:string;patientId?:string;billId?:string;locked?:boolean}){
  const [limit,setLimit]=useState(50),[error,setError]=useState('')
  const generation=useRef(0)
  useLayoutEffect(()=>{const invalidate=()=>{generation.current++};invalidate();return invalidate},[locked,clinicId,patientId,billId])
  const query=useQuery({queryKey:['document-archives',clinicId,patientId,billId,limit],enabled:!locked && !!(patientId||billId),queryFn:async()=>{
    let request=supabase.from('document_archives').select('id,kind,status,created_at,last_error,visits!inner(patient_id)').eq('clinic_id',clinicId)
    // Name-only pharmacy receipts have no visit; use a separate non-join bill query.
    if(billId){const result=await supabase.from('document_archives').select('id,kind,status,created_at,last_error').eq('clinic_id',clinicId).eq('bill_id',billId).eq('kind','receipt');if(result.error)throw result.error;return result.data as Archive[]}
    request=request.eq('visits.patient_id',patientId!)
    const {data,error}=await request.order('created_at',{ascending:false}).order('id').limit(limit+1)
    if(error)throw error
    return data as Archive[]
  }})
  async function open(job:Archive){
    setError('');const version=generation.current
    try{
      const {data:{session}}=await supabase.auth.getSession()
      const blob=await documentRequest<Blob>('archive-content',{id:job.id,clinic_id:clinicId},undefined,true)
      const currentSession=(await supabase.auth.getSession()).data.session
      if(version!==generation.current || locked || isScreenLocked() || currentSession?.user.id!==session?.user.id)return
      const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=`${job.kind}-${job.id}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60_000)
    }catch(failure){setError(failure instanceof Error?failure.message:'Could not open archived PDF.')}
  }
  if(locked)return null
  return <section><h3>Issued PDFs · Google Drive</h3><p className="field-hint">Issued copies stay linked to their original prescription or bill. Structured history remains the clinical record.</p>
    {query.isPending && <LoadingRows label="Loading issued PDFs…" />}
    {query.isError && <p role="alert" className="form-error">Could not load archived PDFs. <button className="ui-button ui-button-neutral" type="button" onClick={()=>void query.refetch()}>Try again</button></p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {query.data?.length===0 && <p className="field-hint">No issued PDFs archived yet.</p>}
    {query.data?.slice(0,limit).map(job=><div className="document-row" key={job.id}><span>{job.kind==='receipt'?'Receipt':'Prescription'} · {formatDate(job.created_at)}</span>{job.status==='ready'?<button className="ui-button ui-button-neutral" type="button" onClick={()=>void open(job)}>Download PDF</button>:<span className="field-hint">Pending upload{job.last_error && ` · ${job.last_error}`}</span>}</div>)}
    {(query.data?.length??0)>limit && <button className="ui-button ui-button-neutral" type="button" onClick={()=>setLimit(value=>value+50)}>Show more</button>}
  </section>
}
