'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { encodeAdjustmentDescription } from '@/actions/_shared/billing-adjustments'
import { getCurrentUser, getCurrentUserProfile, getCurrentUserRole, requireRole } from '@/actions/_shared/user-role'
import type { BillingAdjustmentRecord, BillingApprovalPayload, BillingApprovalJobPayload } from '@/lib/types/billing'

type BillingReviewRow = {
  id: string
  doc_no?: string | number | null
  status?: string | null
}

type PersistedBillingJob = {
  job_assignment_id: string
  amount: number
}

function mapApprovalJobs(selectedJobs: BillingApprovalJobPayload[], billingId: string) {
  return selectedJobs.map((job) => ({
    billing_id: billingId,
    job_assignment_id: job.job_assignment_id || job.id,
    amount: job.request_amount,
    progress_percent: job.progress_percent ?? null,
  }))
}

function mapApprovalAdjustments(
  adjustments: BillingAdjustmentRecord[],
  billingId: string,
  signature: Parameters<typeof encodeAdjustmentDescription>[2]
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

export async function approveBilling(id: string, data: BillingApprovalPayload) {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user) throw new Error('User not found')
  const role = await getCurrentUserRole(supabase, user.id)
  requireRole(['pm', 'admin'], role, 'Only PM/Admin can approve billing')
  const profile = await getCurrentUserProfile(supabase, user.id)

  const billingId = id

  const { data: bill, error: billError } = await supabase
    .from('billings')
    .update({
      status: 'approved',
      approved_by: user.id,
      billing_date: data.billing_date,
      total_work_amount: data.total_work_amount,
      total_add_amount: data.total_add_amount,
      total_deduct_amount: data.total_deduct_amount,
      wht_percent: data.wht_percent,
      retention_percent: data.retention_percent,
      net_amount: data.net_amount,
    })
    .eq('id', billingId)
    .select()
    .single()

  const billing = bill as BillingReviewRow | null
  if (billError) throw new Error(billError.message)

  if (data.selected_jobs.length > 0) {
    await supabase.from('billing_jobs').upsert(mapApprovalJobs(data.selected_jobs, billingId), { onConflict: 'billing_id, job_assignment_id' })
  }

  if (data.adjustments.length > 0) {
    await supabase.from('billing_adjustments').delete().eq('billing_id', billingId)
    await supabase.from('billing_adjustments').insert(
      mapApprovalAdjustments(data.adjustments, billingId, {
        user_id: user.id,
        full_name: profile?.full_name || '',
        role: profile?.role || 'pm',
        action: 'approve_edit',
        at: new Date().toISOString(),
      })
    )
  }

  const { data: billingJobs } = await supabase.from('billing_jobs').select('job_assignment_id, amount').eq('billing_id', billingId)
  const persistedJobs = (billingJobs || []) as PersistedBillingJob[]
  if (persistedJobs.length > 0) {
    await supabase.from('payments').insert(
      persistedJobs.map((job) => ({
        job_assignment_id: job.job_assignment_id,
        amount: job.amount,
        payment_date: data.billing_date,
        note: `เน€เธเธดเธเธ•เธฒเธกเนเธเธงเธฒเธเธเธดเธฅ #${billing?.doc_no || '-'}`,
      }))
    )
  }

  revalidatePath('/dashboard/billing')
  revalidatePath(`/dashboard/billing/${id}`)
  revalidatePath('/dashboard/foreman/history')
  revalidatePath('/dashboard/reports/dc-history')
  revalidatePath('/dashboard/reports/contractor-cycle')
}

export async function rejectBilling(id: string, note?: string) {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user) throw new Error('User not found')
  const role = await getCurrentUserRole(supabase, user.id)
  requireRole(['pm', 'admin'], role, 'Only PM/Admin can reject billing')

  const { error } = await supabase
    .from('billings')
    .update({
      status: 'rejected',
      note,
      approved_by: user.id,
    })
    .eq('id', id)

  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/billing')
  revalidatePath(`/dashboard/billing/${id}`)
  revalidatePath('/dashboard/foreman/history')
  revalidatePath('/dashboard/reports/dc-history')
  revalidatePath('/dashboard/reports/contractor-cycle')
}

export async function undoApproveBilling(id: string) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')
  const role = await getCurrentUserRole(supabase, user.id)
  requireRole(['pm', 'admin'], role, 'Only PM/Admin can undo approve')

  const { data: bill, error: billError } = await supabase
    .from('billings')
    .select('id, doc_no, status')
    .eq('id', id)
    .single()

  const billing = bill as BillingReviewRow | null
  if (billError) throw new Error(billError.message)
  if (!billing) throw new Error('Billing not found')
  if (billing.status !== 'approved') throw new Error('Only approved billing can be reverted')

  const note = `เน€เธเธดเธเธ•เธฒเธกเนเธเธงเธฒเธเธเธดเธฅ #${billing.doc_no || '-'}`
  const { error: paymentDeleteError } = await supabase.from('payments').delete().match({ note })
  if (paymentDeleteError) throw new Error(paymentDeleteError.message)

  const { error: updateError } = await supabase
    .from('billings')
    .update({
      status: 'pending_review',
      approved_by: null,
    })
    .eq('id', id)

  if (updateError) throw new Error(updateError.message)

  revalidatePath('/dashboard/billing')
  revalidatePath(`/dashboard/billing/${id}/review`)
  revalidatePath('/dashboard/foreman/history')
  revalidatePath('/dashboard/reports/dc-history')
  revalidatePath('/dashboard/reports/contractor-cycle')
}

export async function markBillingsAsPaidOut(
  billingIds: string[],
  paidAt: string,
  whtAppliedMap: Record<string, boolean> = {},
  retentionAppliedMap: Record<string, boolean> = {},
  deductAppliedMap: Record<string, boolean> = {}
) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')
  const role = await getCurrentUserRole(supabase, user.id)
  requireRole(['pm', 'admin'], role, 'Only PM/Admin can mark billings as paid out')

  if (!billingIds || billingIds.length === 0) throw new Error('No billing IDs provided')

  const updates = billingIds.map((id) =>
    supabase
      .from('billings')
      .update({
        paid_out_at: paidAt,
        paid_out_by: user.id,
        wht_applied: whtAppliedMap[id] ?? false,
        retention_applied: retentionAppliedMap[id] ?? true,
        deduct_applied: deductAppliedMap[id] ?? true,
      })
      .eq('id', id)
      .eq('status', 'approved')
  )

  const results = await Promise.all(updates)
  const firstError = results.find((r) => r.error)
  if (firstError?.error) throw new Error(firstError.error.message)

  revalidatePath('/dashboard/reports/contractor-cycle')
}

export async function unmarkBillingsAsPaidOut(billingIds: string[]) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')
  const role = await getCurrentUserRole(supabase, user.id)
  requireRole(['pm', 'admin'], role, 'Only PM/Admin can unmark paid out')

  if (!billingIds || billingIds.length === 0) throw new Error('No billing IDs provided')

  const { error } = await supabase
    .from('billings')
    .update({
      paid_out_at: null,
      paid_out_by: null,
    })
    .in('id', billingIds)

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/reports/contractor-cycle')
}
