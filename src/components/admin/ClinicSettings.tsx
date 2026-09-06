import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// clinics has no update policy at all (creating one is a migration/
// service_role action) -- this one field goes through the narrow
// admin_set_clinic_upi_vpa RPC, not a blanket admin UPDATE policy on
// clinics, which would also expose next_token_number (an internal
// counter) to casual editing.
export function ClinicSettings({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['clinic-billing-info', clinicId]
  const { data: clinic } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('clinics').select('name, upi_vpa').eq('id', clinicId).single()
      if (error) throw error
      return data as { name: string; upi_vpa: string | null }
    },
  })

  const [upiVpa, setUpiVpa] = useState('')
  const [formError, setFormError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setUpiVpa(clinic?.upi_vpa ?? '')
  }, [clinic?.upi_vpa])

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('admin_set_clinic_upi_vpa', { p_clinic_id: clinicId, p_upi_vpa: upiVpa })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setSaved(true)
      setFormError('')
    },
    onError: (e: Error) => {
      setFormError(e.message)
      setSaved(false)
    },
  })

  return (
    <div>
      <div className="admin-toolbar">
        <h2 className="readout-heading">Clinic settings</h2>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          setSaved(false)
          save.mutate()
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor="clinic-upi-vpa">
            UPI ID (VPA)
          </label>
          <input
            id="clinic-upi-vpa"
            value={upiVpa}
            onChange={(e) => setUpiVpa(e.target.value)}
            placeholder="clinicname@bank"
          />
          <p className="field-hint">Shown as a QR code on the billing screen when a patient pays by UPI. Leave blank to hide it.</p>
        </div>
        {formError && <p className="form-error">{formError}</p>}
        {saved && !formError && <p className="readout-empty">Saved.</p>}
        <div className="action-row">
          <button type="submit" className="primary-button" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}
