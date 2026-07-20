'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { encodeAdjustmentDescription } from '@/actions/_shared/billing-adjustments'
import {
  getCurrentUser,
  getCurrentUserProfile,
  getCurrentUserRole,
  requireRole,
} from '@/actions/_shared/user-role'
import type {
  BillingActionSignature,
  BillingApprovalPayload,
} from '@/lib/types/billing'
import { computeBillingTotals } from '@/lib/billing'

// The heavy multi-write paths (approve, undo_approve) call the RPCs added in
// migration 202604240001_billing_rpcs. TS still normalizes/validates the
// payload, recomputes monetary totals, and encodes adjustment signatures.

function clampPercent(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 100) return 100
  return n
}

export async function approveBilling(id: string, data: BillingApprovalPayload) {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user) throw new Error('User not found')
  const role = await getCurrentUserRole(supabase, user.id)
  requireRole(['pm', 'admin'], role, 'Only PM/Admin can approve billing')
  const profile = await getCurrentUserProfile(supabase, user.id)

  // SECURITY: always recompute totals server-side from the submitted line
  // items. The client's numeric totals are never trusted.
  const approvalType = data.type === 'extra_work' ? 'extra_work' : 'progress'
  const normalizedJobs = (data.selected_jobs || [])
    .map((job) => ({
      id: String(job.job_assignment_id || job.id || '').trim(),
      request_amount: Math.max(0, Number(job.request_amount) || 0),
      progress_percent: job.progress_percent ?? null,
    }))
    .filter((job) => job.id)

  const normalizedAdjustments = (data.adjustments || []).map((adj) => ({
    type: (adj.type === 'deduction' ? 'deduction' : 'addition') as 'addition' | 'deduction',
    description: String(adj.description || '').trim(),
    plot_name: String(adj.plot_name || '').trim(),
    unit: String(adj.unit || '').trim() || 'unit',
    quantity: Math.max(0, Number(adj.quantity) || 0),
    unit_price: Math.max(0, Number(adj.unit_price) || 0),
  }))

  const totals = computeBillingTotals(approvalType, normalizedJobs, normalizedAdjustments)

  const signature: BillingActionSignature = {
    user_id: user.id,
    full_name: profile?.full_name || '',
    role: profile?.role || 'pm',
    action: 'approve_edit',
    at: new Date().toISOString(),
  }

  const adjustmentsForRpc = normalizedAdjustments.map((adj) => ({
    type: adj.type,
    description: encodeAdjustmentDescription(adj.description, adj.plot_name, signature),
    unit: adj.unit,
    quantity: adj.quantity,
    unit_price: adj.unit_price,
  }))

  const { error } = await supabase.rpc('billing_approve', {
    p_id: id,
    p_payload: {
      billing_date: data.billing_date,
      type: approvalType,
      total_work_amount: totals.total_work_amount,
      total_add_amount: totals.total_add_amount,
      total_deduct_amount: totals.total_deduct_amount,
      net_amount: totals.net_amount,
      wht_percent: clampPercent(data.wht_percent),
      retention_percent: clampPercent(data.retention_percent),
      selected_jobs: normalizedJobs,
      adjustments: adjustmentsForRpc,
    },
  })

  if (error) throw new Error(error.message)

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

  // Single UPDATE — already atomic, no RPC needed.
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

  const { error } = await supabase.rpc('billing_undo_approve', { p_id: id })
  if (error) throw new Error(error.message)

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
  deductAppliedMap: Record<string, boolean> = {},
  // Actual withheld amounts confirmed at payout time. When omitted for a
  // bill, the column is cleared (null) so display code falls back to the
  // percentage formula — set explicitly to override it (e.g. a DC bill that
  // was actually paid with a real retention withholding, which the percent
  // formula can never produce since it's based on total_work_amount).
  retentionAmountMap: Record<string, number> = {},
  whtAmountMap: Record<string, number> = {}
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
        retention_amount: retentionAmountMap[id] ?? null,
        wht_amount: whtAmountMap[id] ?? null,
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
