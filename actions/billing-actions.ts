'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// 1. ดึงข้อมูลเบื้องต้นสำหรับทำ Dropdown
export async function getBillingOptions() {
  const supabase = await createClient()
  
  const [projects, contractors] = await Promise.all([
    supabase.from('projects').select('id, name').order('name'),
    supabase.from('contractors').select('id, name, contractor_types(name)').order('name')
  ])

  return {
    projects: projects.data || [],
    contractors: contractors.data || []
  }
}

// 2. ดึงงานที่พร้อมเบิก (แก้ Foreign Key แล้ว)
export async function getBillableJobs(projectId: string, contractorId: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('job_assignments')
    .select(`
      id,
      status,
      boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, unit, quantity, price_per_unit),
      plots!inner (name, project_id),
      payments (amount)
    `)
    .eq('contractor_id', contractorId)
    .eq('plots.project_id', projectId)
    .neq('status', 'pending') 

  if (error) {
    console.error("Error fetching billable jobs:", error)
    return []
  }

  return data.map((job: any) => {
    const totalBoq = (job.boq_master?.quantity || 0) * (job.boq_master?.price_per_unit || 0)
    const paid = job.payments?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0
    return {
      ...job,
      totalBoq,
      paid,
      remaining: totalBoq - paid
    }
  }).filter((j: any) => j.remaining > 0)
}

// 3. บันทึกบิล
export async function createBilling(data: any) {
  const supabase = await createClient()
  
  // 3.1 สร้าง Header
  const { data: bill, error: billError } = await supabase
    .from('billings')
    .insert([{
      project_id: data.project_id,
      contractor_id: data.contractor_id,
      billing_date: data.billing_date,
      total_work_amount: data.total_work_amount,
      total_add_amount: data.total_add_amount,
      total_deduct_amount: data.total_deduct_amount,
      wht_percent: data.wht_percent,
      retention_percent: data.retention_percent,
      net_amount: data.net_amount,
      status: 'approved'
    }])
    .select()
    .single()

  if (billError) throw new Error(billError.message)

  const billingId = bill.id

  // 3.2 บันทึกรายการงาน
  if (data.selected_jobs.length > 0) {
    const jobsToInsert = data.selected_jobs.map((j: any) => ({
      billing_id: billingId,
      job_assignment_id: j.id,
      amount: j.request_amount
    }))
    await supabase.from('billing_jobs').insert(jobsToInsert)

    // บันทึกลง Payments ด้วย
    const paymentsToInsert = data.selected_jobs.map((j: any) => ({
      job_assignment_id: j.id,
      amount: j.request_amount,
      payment_date: data.billing_date,
      note: `เบิกตามใบวางบิล #${bill.doc_no || '-'}`
    }))
    await supabase.from('payments').insert(paymentsToInsert)
  }

  // 3.3 บันทึกงานเพิ่ม/งานหัก
  if (data.adjustments.length > 0) {
    const adjToInsert = data.adjustments.map((adj: any) => ({
      billing_id: billingId,
      type: adj.type,
      description: adj.description,
      unit: adj.unit,
      quantity: parseFloat(adj.quantity),
      unit_price: parseFloat(adj.unit_price)
    }))
    await supabase.from('billing_adjustments').insert(adjToInsert)
  }

  revalidatePath('/dashboard/billing')
}

// 4. ดึงรายการบิลทั้งหมด
export async function getBillings() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('billings')
    .select(`
      *,
      projects (name),
      contractors (name)
    `)
    .order('created_at', { ascending: false })
  return data || []
}

// 5. [FIXED] ดึงข้อมูลบิลเดียว (แก้ Error ที่ทำให้ Modal ว่างเปล่า)
export async function getBillingById(id: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('billings')
    .select(`
      *,
      projects (name),
      contractors (name, address, phone),
      billing_jobs (
        amount,
        job_assignments (
          plots (name),
          boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, unit)
        )
      ),
      billing_adjustments (*)
    `)
    .eq('id', id)
    .single()

  if (error) {
    console.error("Error fetching billing details:", error)
    return null
  }
  return data
}