'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { BillingJobInput, BillingPayload } from '@/lib/billing'
import { validateBillingPayload } from '@/lib/billing'
import { encodeAdjustmentDescription } from '@/actions/_shared/billing-adjustments'
import { getCurrentUser, getCurrentUserProfile, getCurrentUserRole, requireRole } from '@/actions/_shared/user-role'
import type { BillingAdjustmentRecord } from '@/lib/types/billing'

type BillingDocRow = {
  id: string
  doc_no?: string | number | null
  status?: string
  created_by?: string | null
  submitted_by?: string | null
}

function mapBillingJobs(selectedJobs: BillingJobInput[], billingId: string) {
  return selectedJobs.map((job) => ({
    billing_id: billingId,
    job_assignment_id: job.id,
    amount: job.request_amount,
    progress_percent: job.progress_percent ?? null,
  }))
}

function mapPayments(selectedJobs: BillingJobInput[], billingDate: string, docNo?: string | number | null) {
  return selectedJobs.map((job) => ({
    job_assignment_id: job.id,
    amount: job.request_amount,
    payment_date: billingDate,
    note: `เน€เธเธดเธเธ•เธฒเธกเนเธเธงเธฒเธเธเธดเธฅ #${docNo || '-'}`,
  }))
}

function mapAdjustments(
  adjustments: BillingAdjustmentRecord[],
  billingId: string,
  signature?: Parameters<typeof encodeAdjustmentDescription>[2]
) {
  return adjustments.map((adjustment) => ({
    billing_id: billingId,
    type: adjustment.type,
    description: encodeAdjustmentDescription(adjustment.description, adjustment.plot_name, signature),
    unit: adjustment.unit,
    quantity: Number(adjustment.quantity),
    unit_price: Number(adjustment.unit_price),
  }))
}

export async function createBilling(data: BillingPayload) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  const payload = validateBillingPayload(data)

  const { data: bill, error: billError } = await supabase
    .from('billings')
    .insert([
      {
        project_id: payload.project_id,
        contractor_id: payload.contractor_id,
        billing_date: payload.billing_date,
        total_work_amount: payload.total_work_amount,
        total_add_amount: payload.total_add_amount,
        total_deduct_amount: payload.total_deduct_amount,
        wht_percent: payload.wht_percent,
        retention_percent: payload.retention_percent,
        net_amount: payload.net_amount,
        status: 'approved',
        submitted_by: user?.id,
        approved_by: user?.id,
      },
    ])
    .select()
    .single()

  if (billError) throw new Error(billError.message)

  const billingId = bill.id

  if (payload.selected_jobs.length > 0) {
    await supabase.from('billing_jobs').insert(mapBillingJobs(payload.selected_jobs, billingId))
    await supabase.from('payments').insert(mapPayments(payload.selected_jobs, payload.billing_date, bill.doc_no))
  }

  if (payload.adjustments.length > 0) {
    await supabase.from('billing_adjustments').insert(mapAdjustments(payload.adjustments, billingId))
  }

  revalidatePath('/dashboard/billing')
}

export async function createBillingRequest(data: BillingPayload) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  const payload = validateBillingPayload(data)

  if (!user) throw new Error('User not found')
  const role = await getCurrentUserRole(supabase, user.id)
  requireRole(['foreman', 'pm', 'admin'], role, 'No permission to create billing request')
  const profile = await getCurrentUserProfile(supabase, user.id)

  const requestType = payload.type
  const isExtraWork = requestType === 'extra_work'
  const totalWorkAmount = isExtraWork ? 0 : payload.total_work_amount

  const { data: bill, error: billError } = await supabase
    .from('billings')
    .insert([
      {
        project_id: payload.project_id,
        contractor_id: payload.contractor_id,
        plot_id: payload.plot_id || null,
        billing_date: payload.billing_date,
        note: payload.note,
        total_work_amount: totalWorkAmount,
        total_add_amount: payload.total_add_amount,
        total_deduct_amount: payload.total_deduct_amount,
        net_amount: payload.net_amount,
        status: 'pending_review',
        type: requestType,
        attachment_urls: payload.attachment_urls || null,
        reason_for_dc: payload.reason_for_dc || null,
        created_by: user.id,
        submitted_at: new Date().toISOString(),
        submitted_by: user.id,
      },
    ])
    .select()
    .single()

  if (billError) throw new Error(billError.message)

  const billingId = bill.id

  if (!isExtraWork && payload.selected_jobs.length > 0) {
    await supabase.from('billing_jobs').insert(mapBillingJobs(payload.selected_jobs, billingId))
  }

  if (payload.adjustments.length > 0) {
    await supabase.from('billing_adjustments').insert(
      mapAdjustments(payload.adjustments, billingId, {
        user_id: user.id,
        full_name: profile?.full_name || '',
        role: profile?.role || 'foreman',
        action: 'create',
        at: new Date().toISOString(),
      })
    )
  }

  revalidatePath('/dashboard/billing')
  revalidatePath(`/dashboard/billing/${billingId}/review`)

  return bill
}

export async function updateBillingRequest(id: string, data: BillingPayload) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  const payload = validateBillingPayload(data)

  if (!user) throw new Error('User not found')
  const profile = await getCurrentUserProfile(supabase, user.id)
  const role = profile?.role || 'foreman'
  const isPrivileged = role === 'pm' || role === 'admin'

  const { data: current, error: currentError } = await supabase
    .from('billings')
    .select('id, doc_no, status, created_by, submitted_by')
    .eq('id', id)
    .single()

  const currentBilling = current as BillingDocRow | null
  if (currentError) throw new Error(currentError.message)
  if (!currentBilling) throw new Error('Billing not found')
  if (currentBilling.status !== 'pending_review') throw new Error('Can edit pending review only')

  if (!isPrivileged) {
    if (currentBilling.created_by && currentBilling.created_by !== user.id) throw new Error('No permission to edit this request')
    if (!currentBilling.created_by && currentBilling.submitted_by !== user.id) throw new Error('No permission to edit this request')
  }

  const requestType = payload.type
  const isExtraWork = requestType === 'extra_work'
  const totalWorkAmount = isExtraWork ? 0 : payload.total_work_amount

  const { error: updateError } = await supabase
    .from('billings')
    .update({
      project_id: payload.project_id,
      contractor_id: payload.contractor_id,
      plot_id: payload.plot_id || null,
      billing_date: payload.billing_date,
      note: payload.note,
      total_work_amount: totalWorkAmount,
      total_add_amount: payload.total_add_amount,
      total_deduct_amount: payload.total_deduct_amount,
      net_amount: payload.net_amount,
      type: requestType,
      attachment_urls: payload.attachment_urls || null,
      reason_for_dc: payload.reason_for_dc || null,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (updateError) throw new Error(updateError.message)

  await supabase.from('billing_jobs').delete().eq('billing_id', id)
  await supabase.from('billing_adjustments').delete().eq('billing_id', id)

  if (!isExtraWork && payload.selected_jobs.length > 0) {
    await supabase.from('billing_jobs').insert(mapBillingJobs(payload.selected_jobs, id))
  }

  if (payload.adjustments.length > 0) {
    await supabase.from('billing_adjustments').insert(
      mapAdjustments(payload.adjustments, id, {
        user_id: user.id,
        full_name: profile?.full_name || '',
        role,
        action: 'edit',
        at: new Date().toISOString(),
      })
    )
  }

  revalidatePath('/dashboard/foreman/history')
  revalidatePath(`/dashboard/billing/${id}/review`)

  return { id, doc_no: currentBilling.doc_no }
}

export async function deleteBilling(id: string) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')
  const role = await getCurrentUserRole(supabase, user.id)

  const { data: bill, error: billError } = await supabase
    .from('billings')
    .select('id, doc_no, status, created_by, submitted_by')
    .eq('id', id)
    .single()

  const billing = bill as BillingDocRow | null
  if (billError) throw new Error(billError.message)
  if (!billing) throw new Error('Billing not found.')

  const isOwner = billing.created_by === user.id || billing.submitted_by === user.id
  if (billing.status === 'approved' && !(role === 'pm' || role === 'admin')) {
    throw new Error('Only PM/Admin can delete approved billing')
  }
  if (billing.status !== 'approved' && !(isOwner || role === 'pm' || role === 'admin')) {
    throw new Error('No permission to delete this billing')
  }

  if (billing.status === 'approved') {
    const note = `เน€เธเธดเธเธ•เธฒเธกเนเธเธงเธฒเธเธเธดเธฅ #${billing.doc_no || '-'}`
    await supabase.from('payments').delete().match({ note })
  }

  await supabase.from('billing_jobs').delete().match({ billing_id: id })
  await supabase.from('billing_adjustments').delete().match({ billing_id: id })

  const { error } = await supabase.from('billings').delete().match({ id })
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/billing')
}
