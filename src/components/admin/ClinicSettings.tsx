import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatPaiseForInput, parseRupeesToPaise } from '../../lib/money'

// clinics has no update policy at all (creating one is a migration/
// service_role action) -- each field here goes through its own narrow
// admin-gated RPC, not a blanket admin UPDATE policy on clinics, which
// would also expose next_token_number (an internal counter) to casual
// editing.
export function ClinicSettings({ clinicId }: { clinicId: string }) {
  const queryClient = useQueryClient()
  const queryKey = ['clinic-billing-info', clinicId]
  const { data: clinic } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clinics')
        .select('name, upi_vpa, doctor_name, doctor_registration_number, consultation_fee_paise')
        .eq('id', clinicId)
        .single()
      if (error) throw error
      return data as {
        name: string
        upi_vpa: string | null
        doctor_name: string | null
        doctor_registration_number: string | null
        consultation_fee_paise: number
      }
    },
  })

  const [upiVpa, setUpiVpa] = useState('')
  const [doctorName, setDoctorName] = useState('')
  const [doctorRegNo, setDoctorRegNo] = useState('')
  const [feeDraft, setFeeDraft] = useState('')
  const [formError, setFormError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setUpiVpa(clinic?.upi_vpa ?? '')
    setDoctorName(clinic?.doctor_name ?? '')
    setDoctorRegNo(clinic?.doctor_registration_number ?? '')
    setFeeDraft(clinic ? formatPaiseForInput(clinic.consultation_fee_paise) : '')
  }, [clinic])

  const save = useMutation({
    mutationFn: async () => {
      const feePaise = parseRupeesToPaise(feeDraft)
      if (feePaise === null) throw new Error('Consultation fee must be a plain amount, e.g. 250 or 250.00')
      const { error: upiErr } = await supabase.rpc('admin_set_clinic_upi_vpa', { p_clinic_id: clinicId, p_upi_vpa: upiVpa })
      if (upiErr) throw upiErr
      const { error: doctorErr } = await supabase.rpc('admin_set_clinic_doctor_info', {
        p_clinic_id: clinicId,
        p_doctor_name: doctorName,
        p_doctor_registration_number: doctorRegNo,
      })
      if (doctorErr) throw doctorErr
      const { error: feeErr } = await supabase.rpc('admin_set_clinic_fee', { p_clinic_id: clinicId, p_fee_paise: feePaise })
      if (feeErr) throw feeErr
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
        <div className="field">
          <label className="field-label" htmlFor="clinic-consultation-fee">
            Consultation fee (₹)
          </label>
          <input id="clinic-consultation-fee" value={feeDraft} onChange={(e) => setFeeDraft(e.target.value)} placeholder="250" />
          <p className="field-hint">Charged flat on every visit. Only changes new visits and any open visit whose procedures/medicines are edited afterward.</p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="clinic-doctor-name">
            Doctor's name
          </label>
          <input id="clinic-doctor-name" value={doctorName} onChange={(e) => setDoctorName(e.target.value)} placeholder="Dr. ..." />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="clinic-doctor-reg-no">
            Doctor's registration number
          </label>
          <input id="clinic-doctor-reg-no" value={doctorRegNo} onChange={(e) => setDoctorRegNo(e.target.value)} />
          <p className="field-hint">Printed on certificates, sick-leave notes, and referral letters.</p>
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
