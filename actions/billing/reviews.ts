'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { encodeAdjustmentDescription } from '@/actions/_shared/billing-adjustments'
import { translateBillingError } from '@/actions/_shared/billing-errors'
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

export type BillingActionResult = { ok: true } | { error: string }

function clampPercent(value: unknown) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 100) return 100
  return n
}

export async function approveBilling(id: string, data: BillingApprovalPayload): Promise<BillingActionResult> {
  try {
    const supabase = await createClient()
    const user = await getCurrentUser()

    if (!user) return { error: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง' }
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

    if (error) return { error: translateBillingError(error.message) }

    revalidatePath('/dashboard/billing')
    revalidatePath(`/dashboard/billing/${id}`)
    revalidatePath('/dashboard/foreman/history')
    revalidatePath('/dashboard/reports/dc-history')
    revalidatePath('/dashboard/reports/contractor-cycle')
    return { ok: true }
  } catch (error) {
    return { error: translateBillingError(error instanceof Error ? error.message : 'อนุมัติใบเบิกไม่สำเร็จ') }
  }
}

export async function rejectBilling(id: string, note?: string): Promise<BillingActionResult> {
  try {
    const supabase = await createClient()
    const user = await getCurrentUser()

    if (!user) return { error: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง' }
    const role = await getCurrentUserRole(supabase, user.id)
    requireRole(['pm', 'admin'], role, 'Only PM/Admin can reject billing')

    // RPC (not a plain UPDATE) so the status change and the "notify the
    // submitter" insert can't get out of sync with each other.
    const { error } = await supabase.rpc('billing_reject', { p_id: id, p_note: note ?? null })

    if (error) return { error: translateBillingError(error.message) }

    revalidatePath('/dashboard/billing')
    revalidatePath(`/dashboard/billing/${id}`)
    revalidatePath('/dashboard/foreman/history')
    revalidatePath('/dashboard/reports/dc-history')
    revalidatePath('/dashboard/reports/contractor-cycle')
    return { ok: true }
  } catch (error) {
    return { error: translateBillingError(error instanceof Error ? error.message : 'ปฏิเสธใบเบิกไม่สำเร็จ') }
  }
}

export async function undoApproveBilling(id: string): Promise<BillingActionResult> {
  try {
    const supabase = await createClient()
    const user = await getCurrentUser()
    if (!user) return { error: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง' }
    const role = await getCurrentUserRole(supabase, user.id)
    requireRole(['pm', 'admin'], role, 'Only PM/Admin can undo approve')

    const { error } = await supabase.rpc('billing_undo_approve', { p_id: id })
    if (error) return { error: translateBillingError(error.message) }

    revalidatePath('/dashboard/billing')
    revalidatePath(`/dashboard/billing/${id}/review`)
    revalidatePath('/dashboard/foreman/history')
    revalidatePath('/dashboard/reports/dc-history')
    revalidatePath('/dashboard/reports/contractor-cycle')
    return { ok: true }
  } catch (error) {
    return { error: translateBillingError(error instanceof Error ? error.message : 'ย้อนสถานะอนุมัติไม่สำเร็จ') }
  }
}

/** One all-or-nothing RPC call (billing_mark_paid_out) instead of a separate
 * update per bill - see 202609230005_billing_status_rules_and_payout.sql for
 * why the old Promise.all-of-independent-updates version wasn't safe. */
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
): Promise<BillingActionResult> {
  try {
    const supabase = await createClient()
    const user = await getCurrentUser()
    if (!user) return { error: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง' }
    const role = await getCurrentUserRole(supabase, user.id)
    requireRole(['pm', 'admin', 'accountant'], role, 'Only PM/Admin/Accountant can mark billings as paid out')

    if (!billingIds || billingIds.length === 0) return { error: 'กรุณาเลือกรายการ' }

    const items = billingIds.map((id) => ({
      id,
      wht_applied: whtAppliedMap[id] ?? false,
      retention_applied: retentionAppliedMap[id] ?? true,
      deduct_applied: deductAppliedMap[id] ?? true,
      retention_amount: retentionAmountMap[id] ?? null,
      wht_amount: whtAmountMap[id] ?? null,
    }))

    const { error } = await supabase.rpc('billing_mark_paid_out', { p_items: items, p_paid_at: paidAt })
    if (error) return { error: translateBillingError(error.message) }

    revalidatePath('/dashboard/reports/contractor-cycle')
    return { ok: true }
  } catch (error) {
    return { error: translateBillingError(error instanceof Error ? error.message : 'บันทึกการจ่ายเงินไม่สำเร็จ') }
  }
}

export async function unmarkBillingsAsPaidOut(billingIds: string[]): Promise<BillingActionResult> {
  try {
    const supabase = await createClient()
    const user = await getCurrentUser()
    if (!user) return { error: 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง' }
    const role = await getCurrentUserRole(supabase, user.id)
    requireRole(['pm', 'admin', 'accountant'], role, 'Only PM/Admin/Accountant can unmark paid out')

    if (!billingIds || billingIds.length === 0) return { error: 'กรุณาเลือกรายการ' }

    const { error } = await supabase.rpc('billing_unmark_paid_out', { p_ids: billingIds })
    if (error) return { error: translateBillingError(error.message) }

    revalidatePath('/dashboard/reports/contractor-cycle')
    return { ok: true }
  } catch (error) {
    return { error: translateBillingError(error instanceof Error ? error.message : 'ยกเลิกการจ่ายเงินไม่สำเร็จ') }
  }
}
