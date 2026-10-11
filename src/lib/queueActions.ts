import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { attemptOrQueue } from './offlineQueue'

export type QueueAction = 'call' | 'sent_in' | 'finish' | 'move_up' | 'move_down' | 'not_here' | 'return_original' | 'return_end' | 'no_show'
type QueueRow = { id: string; stage: string; queue_position?: number; arrived_at?: string }
export function useQueueAction(clinicId: string | null | undefined) {
  const client = useQueryClient()
  return useMutation({ networkMode: 'always', mutationFn: async ({ visitId, action, reason }: { visitId: string; action: QueueAction; reason?: string }) => {
    const time = new Date().toISOString()
    const args = { p_visit_id: visitId, p_action: action, p_request_id: crypto.randomUUID(), p_reason: reason || null, p_occurred_at: time }
    await attemptOrQueue({ clinicId,
      attempt: token => supabase.rpc('queue_visit_action', args).setHeader('Authorization', `Bearer ${token}`),
      queueItem: () => ({ kind: 'rpc', rpc: 'queue_visit_action', payload: args, description: `Queue: ${action.replaceAll('_', ' ')}` }),
      applyOptimistic: () => {
        for (const key of ['doctor-queue', 'visits-today', 'shell-queue']) client.setQueryData<QueueRow[]>([key, clinicId], old => {
          if (!old) return old
          const rows = old.map(v => ({ ...v }))
          const row = rows.find(v => v.id === visitId)
          if (!row) return old
          const stages: Partial<Record<QueueAction,string>> = {call:'called',sent_in:'with_doctor',finish:'ready_to_bill',not_here:'not_here',return_original:'waiting',return_end:'waiting',no_show:'no_show'}
          Object.assign(row, {stage:stages[action] ?? row.stage}, action === 'call' ? {called_at:time} : action === 'sent_in' ? {sent_in_at:time,with_doctor_at:time} : action === 'not_here' ? {not_here_at:time} : {})
          if (action==='return_end') row.queue_position=Math.max(0,...rows.map(v=>v.queue_position??0))+1024
          if (action==='move_up'||action==='move_down') {
            const waiting=rows.filter(v=>v.stage==='waiting' && v.arrived_at && row.arrived_at && new Date(v.arrived_at).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})===new Date(row.arrived_at).toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'})).sort((a,b)=>(a.queue_position??0)-(b.queue_position??0))
            const index=waiting.findIndex(v=>v.id===visitId), other=waiting[index+(action==='move_up'?-1:1)]
            if(other) [row.queue_position,other.queue_position]=[other.queue_position,row.queue_position]
          }
          return rows.sort((a,b)=>(a.queue_position??0)-(b.queue_position??0))
        })
      },
    })
  }, onSuccess: () => { for(const key of ['doctor-queue','visits-today','shell-queue','doctor-today-metrics','billing-visits','queue-events']) void client.invalidateQueries({queryKey:[key,clinicId]}) } })
}
