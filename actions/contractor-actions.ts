'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { normalizeAdjustmentsWithPlot } from '@/actions/_shared/billing-adjustments'
import { derivePlotLabelFromJobs } from '@/actions/_shared/plot-maps'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { computeActualPayout } from '@/lib/billing'

// ดึงรายชื่อผู้รับเหมาทั้งหมด (พร้อมชื่อประเภทช่าง)
export async function getContractors() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contractors')
    .select(`
      *,
      contractor_types (name)
    `)
    .order('created_at', { ascending: false })
  
  if (error) throw new Error(error.message)

  // Source of truth for "accumulated paid" is what the accountant actually
  // marked as paid out (paid_out_at), computed with the WHT/retention/deduct
  // flags they chose at payout time — NOT the amount a PM approved. Bills
  // still awaiting payout must not count toward total_paid.
  const { data: approvedBills, error: approvedBillsError } = await supabase
    .from('billings')
    .select('contractor_id, type, total_work_amount, total_add_amount, total_deduct_amount, wht_percent, retention_percent, paid_out_at, wht_applied, retention_applied, deduct_applied, retention_amount, wht_amount')
    .eq('status', 'approved')
    .not('contractor_id', 'is', null)
    .not('paid_out_at', 'is', null)

  if (approvedBillsError) throw new Error(approvedBillsError.message)

  const paidByContractor = new Map<string, number>()
  const retentionByContractor = new Map<string, number>()
  for (const bill of approvedBills || []) {
    const contractorId = bill.contractor_id == null ? null : String(bill.contractor_id)
    if (!contractorId) continue
    paidByContractor.set(contractorId, (paidByContractor.get(contractorId) || 0) + computeActualPayout(bill))
    if (bill.retention_applied !== false) {
      const retention = bill.retention_amount != null
        ? Number(bill.retention_amount)
        : Number(bill.total_work_amount || 0) * (Number(bill.retention_percent || 0) / 100)
      retentionByContractor.set(contractorId, (retentionByContractor.get(contractorId) || 0) + retention)
    }
  }

  return (data || []).map((contractor) => ({
    ...contractor,
    total_paid: paidByContractor.get(String(contractor.id)) || 0,
    total_retention: retentionByContractor.get(String(contractor.id)) || 0,
  }))
}

export async function getContractorApprovedHistory(contractorId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('billings')
    .select(`
      id,
      doc_no,
      billing_date,
      created_at,
      plot_id,
      type,
      total_work_amount,
      total_add_amount,
      total_deduct_amount,
      net_amount,
      retention_percent,
      wht_percent,
      paid_out_at,
      wht_applied,
      retention_applied,
      deduct_applied,
      retention_amount,
      wht_amount,
      reason_for_dc,
      note,
      projects (name),
      billing_jobs (
        id,
        job_assignment_id,
        amount,
        progress_percent,
        job_assignments (
          plots (name),
          boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name)
        )
      ),
      billing_adjustments (id, type, description, unit, quantity, unit_price)
    `)
    .eq('contractor_id', contractorId)
    .eq('status', 'approved')
    .order('billing_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  const rows = data || []
  const plotIds = rows.map((b: any) => b.plot_id).filter(Boolean)
  const plotMap = new Map<string, string>()
  if (plotIds.length > 0) {
    const { data: plots, error: plotError } = await supabase
      .from('plots')
      .select('id, name')
      .in('id', Array.from(new Set(plotIds)))
    if (plotError) throw new Error(plotError.message)
    for (const p of plots || []) plotMap.set(String(p.id), p.name)
  }

  // Each billing_jobs row only stores the cumulative progress % *as of that
  // billing* — there's no stored "previous %" to show a from-to range. Since
  // one job_assignment belongs to a single contractor, this contractor's own
  // approved-history rows already contain its full progress trail: sort all
  // billing_jobs entries per job_assignment chronologically and take the
  // prior entry's progress_percent as the "from" value (0 if it's the first).
  const jobEntries: Array<{ billId: string; jobId: string; jobAssignmentId: string | null; at: number; progress: number | null }> = []
  for (const bill of rows as any[]) {
    const at = new Date(bill.billing_date || bill.created_at || 0).getTime()
    for (const job of bill.billing_jobs || []) {
      jobEntries.push({
        billId: bill.id,
        jobId: job.id,
        jobAssignmentId: job.job_assignment_id ? String(job.job_assignment_id) : null,
        at,
        progress: job.progress_percent == null ? null : Number(job.progress_percent),
      })
    }
  }
  const entriesByAssignment = new Map<string, typeof jobEntries>()
  for (const entry of jobEntries) {
    if (!entry.jobAssignmentId) continue
    const arr = entriesByAssignment.get(entry.jobAssignmentId) || []
    arr.push(entry)
    entriesByAssignment.set(entry.jobAssignmentId, arr)
  }
  const previousProgressByJobId = new Map<string, number>()
  for (const entries of entriesByAssignment.values()) {
    entries.sort((a, b) => a.at - b.at)
    let previous = 0
    for (const entry of entries) {
      previousProgressByJobId.set(entry.jobId, previous)
      if (entry.progress != null) previous = entry.progress
    }
  }

  return rows.map((bill: any) => ({
    ...bill,
    billing_adjustments: normalizeAdjustmentsWithPlot(bill.billing_adjustments),
    plots: bill.plot_id
      ? { name: plotMap.get(String(bill.plot_id)) || null }
      : { name: derivePlotLabelFromJobs(bill.billing_jobs) },
    billing_jobs: (bill.billing_jobs || []).map((job: any) => ({
      ...job,
      previous_progress_percent: previousProgressByJobId.get(job.id) ?? 0,
    })),
    actual_payout: bill.paid_out_at ? computeActualPayout(bill) : null,
  }))
}

function buildBankAccount(formData: FormData) {
  const bankName = (formData.get('bank_name') as string || '').trim()
  const accountNumber = (formData.get('bank_account_number') as string || '').trim()
  if (bankName && accountNumber) return `${bankName} || ${accountNumber}`
  if (bankName) return bankName
  if (accountNumber) return accountNumber
  return (formData.get('bank_account') as string || '').trim()
}

// เพิ่มผู้รับเหมาใหม่
export async function createContractor(formData: FormData) {
  await requireModuleAccess('contractors')
  const supabase = await createClient()

  const name = formData.get('name') as string
  const type_id = formData.get('type_id') as string
  const phone = formData.get('phone') as string
  const bank_account = buildBankAccount(formData)
  const tax_id = formData.get('tax_id') as string

  if (!name || !type_id) return

  const { error } = await supabase
    .from('contractors')
    .insert([{ 
      name, 
      type_id: parseInt(type_id), 
      phone, 
      bank_account,
      tax_id 
    }])

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/contractors')
}

// ลบผู้รับเหมา
export async function deleteContractor(id: string) {
  await requireModuleAccess('contractors')
  const supabase = await createClient()
  const { error } = await supabase.from('contractors').delete().match({ id })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/contractors')
}

// อัปเดตผู้รับเหมา
export async function updateContractor(id: string, formData: FormData) {
  await requireModuleAccess('contractors')
  const supabase = await createClient()

  const name = formData.get('name') as string
  const type_id = formData.get('type_id') as string
  const phone = formData.get('phone') as string
  const bank_account = buildBankAccount(formData)
  const tax_id = formData.get('tax_id') as string

  if (!name || !type_id) return

  const { error } = await supabase
    .from('contractors')
    .update({
      name,
      type_id: parseInt(type_id),
      phone,
      bank_account,
      tax_id
    })
    .match({ id })

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/contractors')
}
