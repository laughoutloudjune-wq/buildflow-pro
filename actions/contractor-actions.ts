'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

function decodeAdjustmentDescription(rawDescription: string | null | undefined) {
  const raw = rawDescription || ''
  const match = raw.match(/^\[PLOT:(.+?)\]\s*(.*)$/)
  if (!match) return { description: raw, plot_name: '' }
  return { plot_name: (match[1] || '').trim(), description: (match[2] || '').trim() }
}

function normalizeAdjustmentsWithPlot(adjustments: any[] | null | undefined) {
  return (adjustments || []).map((adj: any) => {
    const parsed = decodeAdjustmentDescription(adj.description)
    return {
      ...adj,
      description: parsed.description,
      plot_name: parsed.plot_name || '',
      raw_description: adj.description || '',
    }
  })
}

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

  // Use approved bill net totals as the source of truth for accumulated paid amount.
  const { data: approvedBills, error: approvedBillsError } = await supabase
    .from('billings')
    .select('contractor_id, type, net_amount, total_work_amount, total_add_amount, total_deduct_amount, wht_percent, retention_percent')
    .eq('status', 'approved')
    .not('contractor_id', 'is', null)

  if (approvedBillsError) throw new Error(approvedBillsError.message)

  const paidByContractor = new Map<string, number>()
  for (const bill of approvedBills || []) {
    const contractorId = bill.contractor_id == null ? null : String(bill.contractor_id)
    if (!contractorId) continue
    const work = Number(bill.total_work_amount || 0)
    const add = Number(bill.total_add_amount || 0)
    const deduct = Number(bill.total_deduct_amount || 0)
    const wht = add * (Number(bill.wht_percent || 0) / 100)
    const retention = work * (Number(bill.retention_percent || 0) / 100)
    const fallbackNet = bill.type === 'extra_work'
      ? (add - deduct)
      : (work + add - deduct - wht - retention)
    const billNet = Number(bill.net_amount ?? fallbackNet)
    paidByContractor.set(
      contractorId,
      (paidByContractor.get(contractorId) || 0) + billNet
    )
  }

  // Fallback path from payment records (helps when legacy bills have missing/incorrect net values).
  const { data: assignmentPayments, error: assignmentPaymentsError } = await supabase
    .from('job_assignments')
    .select('contractor_id, payments (amount)')
    .not('contractor_id', 'is', null)
  if (assignmentPaymentsError) throw new Error(assignmentPaymentsError.message)

  const paidByPayment = new Map<string, number>()
  for (const row of assignmentPayments || []) {
    const contractorId = row.contractor_id == null ? null : String(row.contractor_id)
    if (!contractorId) continue
    const sum = (row.payments || []).reduce(
      (acc: number, p: { amount: number | null }) => acc + Number(p.amount || 0),
      0
    )
    paidByPayment.set(contractorId, (paidByPayment.get(contractorId) || 0) + sum)
  }

  return (data || []).map((contractor) => ({
    ...contractor,
    total_paid: Math.max(
      paidByContractor.get(String(contractor.id)) || 0,
      paidByPayment.get(String(contractor.id)) || 0
    ),
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
      plot_id,
      type,
      total_work_amount,
      total_add_amount,
      total_deduct_amount,
      net_amount,
      reason_for_dc,
      note,
      projects (name),
      billing_jobs (
        id,
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

  return rows.map((bill: any) => ({
    ...bill,
    billing_adjustments: normalizeAdjustmentsWithPlot(bill.billing_adjustments),
    plots: bill.plot_id ? { name: plotMap.get(String(bill.plot_id)) || null } : null,
  }))
}

// เพิ่มผู้รับเหมาใหม่
export async function createContractor(formData: FormData) {
  const supabase = await createClient()
  
  const name = formData.get('name') as string
  const type_id = formData.get('type_id') as string
  const phone = formData.get('phone') as string
  const bank_account = formData.get('bank_account') as string
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
  const supabase = await createClient()
  const { error } = await supabase.from('contractors').delete().match({ id })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/contractors')
}

// อัปเดตผู้รับเหมา
export async function updateContractor(id: string, formData: FormData) {
  const supabase = await createClient()

  const name = formData.get('name') as string
  const type_id = formData.get('type_id') as string
  const phone = formData.get('phone') as string
  const bank_account = formData.get('bank_account') as string
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
