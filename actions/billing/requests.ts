'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { BillingJobInput, BillingPayload } from '@/lib/billing'
import { validateBillingPayload } from '@/lib/billing'
import { encodeAdjustmentDescription } from '@/actions/_shared/billing-adjustments'
import {
  getCurrentUser,
  getCurrentUserProfile,
  getCurrentUserRole,
  requireRole,
} from '@/actions/_shared/user-role'
import { buildBillingPaymentNote } from '@/actions/_shared/payment-notes'
import type {
  BillingActionSignature,
  BillingAdjustmentRecord,
} from '@/lib/types/billing'

// All multi-step DB writes for a billing (request / update / approve / undo /
// delete) live in PL/pgSQL RPCs added in migration 202604240001_billing_rpcs.
// TS still handles input validation, totals recomputation, and encoding the
// adjustment description (which captures author signature + plot name). The
// RPC accepts already-encoded descriptions and just does the atomic writes.

type JobsForRpc = Array<{
  id: string
  request_amount: number
  progress_percent: number | null
}>

type AdjustmentsForRpc = Array<{
  type: 'addition' | 'deduction'
  description: string
  unit: string
  quantity: number
  unit_price: number
}>

function toJobsForRpc(selectedJobs: BillingJobInput[]): JobsForRpc {
  return selectedJobs
    .filter((job) => job.id)
    .map((job) => ({
      id: job.id,
      request_amount: Number(job.request_amount) || 0,
      progress_percent: job.progress_percent ?? null,
    }))
}

function toAdjustmentsForRpc(
  adjustments: BillingAdjustmentRecord[],
  signature?: BillingActionSignature
): AdjustmentsForRpc {
  return adjustments.map((adjustment) => ({
    type: adjustment.type,
    description: encodeAdjustmentDescription(
      adjustment.description,
      adjustment.plot_name,
      signature
    ),
    unit: adjustment.unit,
    quantity: Number(adjustment.quantity) || 0,
    unit_price: Number(adjustment.unit_price) || 0,
  }))
}

// Legacy direct-approve create path. No UI currently calls this, but we keep
// the export in case an external script does. It is NOT RPC-wrapped; if it is
// revived for real use, move it over to `billing_approve` plus an insert RPC.
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
    const note = buildBillingPaymentNote(bill.doc_no)
    await supabase.from('billing_jobs').insert(
      payload.selected_jobs.map((job) => ({
        billing_id: billingId,
        job_assignment_id: job.id,
        amount: job.request_amount,
        progress_percent: job.progress_percent ?? null,
      }))
    )
    await supabase.from('payments').insert(
      payload.selected_jobs.map((job) => ({
        billing_id: billingId,
        job_assignment_id: job.id,
        amount: job.request_amount,
        payment_date: payload.billing_date,
        note,
      }))
    )
  }

  if (payload.adjustments.length > 0) {
    await supabase.from('billing_adjustments').insert(
      payload.adjustments.map((adjustment) => ({
        billing_id: billingId,
        type: adjustment.type,
        description: encodeAdjustmentDescription(
          adjustment.description,
          adjustment.plot_name
        ),
        unit: adjustment.unit,
        quantity: Number(adjustment.quantity),
        unit_price: Number(adjustment.unit_price),
      }))
    )
  }

  revalidatePath('/dashboard/billing')
}

export type BillingRequestResult =
  | { success: true; id: string; doc_no?: string | number }
  | { success: false; error: string }

export async function createBillingRequest(data: BillingPayload): Promise<BillingRequestResult> {
  try {
    const supabase = await createClient()
    const user = await getCurrentUser()
    const payload = validateBillingPayload(data)

    if (!user) return { success: false, error: 'User not found' }
    const role = await getCurrentUserRole(supabase, user.id)
    if (!['foreman', 'pm', 'admin'].includes(role)) {
      return { success: false, error: 'No permission to create billing request' }
    }
    const profile = await getCurrentUserProfile(supabase, user.id)

    const signature: BillingActionSignature = {
      user_id: user.id,
      full_name: profile?.full_name || '',
      role: profile?.role || 'foreman',
      action: 'create',
      at: new Date().toISOString(),
    }

    const { data: result, error } = await supabase.rpc('billing_create_request', {
      p_payload: {
        project_id: payload.project_id,
        contractor_id: payload.contractor_id,
        plot_id: payload.plot_id ?? null,
        billing_date: payload.billing_date,
        note: payload.note ?? null,
        type: payload.type,
        total_work_amount: payload.total_work_amount,
        total_add_amount: payload.total_add_amount,
        total_deduct_amount: payload.total_deduct_amount,
        net_amount: payload.net_amount,
        attachment_urls: payload.attachment_urls ?? null,
        reason_for_dc: payload.reason_for_dc ?? null,
        selected_jobs: toJobsForRpc(payload.selected_jobs),
        adjustments: toAdjustmentsForRpc(payload.adjustments, signature),
      },
    })

    if (error) return { success: false, error: error.message }

    const row = (result ?? {}) as { id: string; doc_no?: string | number | null }
    const doc_no = row.doc_no == null ? undefined : row.doc_no
    revalidatePath('/dashboard/billing')
    if (row.id) revalidatePath(`/dashboard/billing/${row.id}/review`)

    return { success: true, id: row.id, doc_no }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create billing request' }
  }
}

export async function updateBillingRequest(id: string, data: BillingPayload): Promise<BillingRequestResult> {
  try {
    const supabase = await createClient()
    const user = await getCurrentUser()
    const payload = validateBillingPayload(data)

    if (!user) return { success: false, error: 'User not found' }
    const profile = await getCurrentUserProfile(supabase, user.id)
    const role = profile?.role || 'foreman'

    const signature: BillingActionSignature = {
      user_id: user.id,
      full_name: profile?.full_name || '',
      role,
      action: 'edit',
      at: new Date().toISOString(),
    }

    const { data: result, error } = await supabase.rpc('billing_update_request', {
      p_id: id,
      p_payload: {
        project_id: payload.project_id,
        contractor_id: payload.contractor_id,
        plot_id: payload.plot_id ?? null,
        billing_date: payload.billing_date,
        note: payload.note ?? null,
        type: payload.type,
        total_work_amount: payload.total_work_amount,
        total_add_amount: payload.total_add_amount,
        total_deduct_amount: payload.total_deduct_amount,
        net_amount: payload.net_amount,
        attachment_urls: payload.attachment_urls ?? null,
        reason_for_dc: payload.reason_for_dc ?? null,
        selected_jobs: toJobsForRpc(payload.selected_jobs),
        adjustments: toAdjustmentsForRpc(payload.adjustments, signature),
      },
    })

    if (error) return { success: false, error: error.message }

    const row = (result ?? {}) as { id?: string; doc_no?: string | number | null }
    const doc_no = row.doc_no == null ? undefined : row.doc_no
    revalidatePath('/dashboard/foreman/history')
    revalidatePath(`/dashboard/billing/${id}/review`)

    return { success: true, id, doc_no }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to update billing request' }
  }
}

export async function deleteBilling(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.rpc('billing_delete', { p_id: id })
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/billing')
}
