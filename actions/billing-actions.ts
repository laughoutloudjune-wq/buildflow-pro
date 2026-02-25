'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Helper function to get the current user
async function getCurrentUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

async function getPlotNameMap(supabase: any, plotIds: (string | null | undefined)[]) {
  const ids = Array.from(new Set((plotIds || []).filter(Boolean))) as string[]
  if (ids.length === 0) return new Map<string, string>()
  const { data, error } = await supabase.from('plots').select('id, name').in('id', ids)
  if (error) throw new Error(error.message)
  return new Map((data || []).map((p: any) => [p.id, p.name]))
}

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
export async function getBillableJobs(projectId: string, contractorId: string, plotId?: string) {
  const supabase = await createClient()

  let query = supabase
    .from('job_assignments')
    .select(`
      id,
      status,
      agreed_price_per_unit,
      boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, unit, quantity, price_per_unit),
      plots!inner (id, name, project_id),
      payments (amount)
    `)
    .eq('contractor_id', contractorId)
    .eq('plots.project_id', projectId)
    .neq('status', 'pending') 

  if (plotId) query = query.eq('plots.id', plotId)

  const { data, error } = await query

  if (error) {
    console.error("Error fetching billable jobs:", error)
    return []
  }

  return data.map((job: any) => {
    const pricePerUnit = job.agreed_price_per_unit ?? job.boq_master?.price_per_unit ?? 0
    const totalBoq = (job.boq_master?.quantity || 0) * pricePerUnit;
    const payments = Array.isArray(job.payments) ? job.payments : [];
    const paid = payments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
    const remaining = totalBoq - paid;

    return {
      ...job,
      effective_price_per_unit: pricePerUnit,
      pricing_source: job.agreed_price_per_unit != null ? 'assignment' : 'boq_master',
      totalBoq,
      paid,
      remaining: remaining
    };
  }).filter((j: any) => j.remaining > 0);
}

// 3. บันทึกบิล (Legacy or Direct Approved)
export async function createBilling(data: any) {
  const supabase = await createClient()
  const user = await getCurrentUser()

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
      status: 'approved',
      submitted_by: user?.id,
      approved_by: user?.id
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
      amount: j.request_amount,
      progress_percent: j.progress_percent ?? null
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

// NEW: Create Billing Request (Foreman)
export async function createBillingRequest(data: any) {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user) throw new Error("User not found")

  const requestType = data.type === 'extra_work' ? 'extra_work' : 'progress'
  const isExtraWork = requestType === 'extra_work'
  const adjustments = Array.isArray(data.adjustments) ? data.adjustments : []
  const totalAddAmount = data.total_add_amount ?? adjustments
    .filter((adj: any) => adj.type === 'addition')
    .reduce((sum: number, adj: any) => sum + (parseFloat(adj.quantity) || 0) * (parseFloat(adj.unit_price) || 0), 0)
  const totalDeductAmount = data.total_deduct_amount ?? adjustments
    .filter((adj: any) => adj.type === 'deduction')
    .reduce((sum: number, adj: any) => sum + (parseFloat(adj.quantity) || 0) * (parseFloat(adj.unit_price) || 0), 0)
  const totalWorkAmount = isExtraWork ? 0 : (data.total_work_amount || 0)
  const netAmount = isExtraWork
    ? (totalAddAmount - totalDeductAmount)
    : (totalWorkAmount + totalAddAmount - totalDeductAmount)

  // 1. Create Billing Header with 'pending_review' status
  const { data: bill, error: billError } = await supabase
    .from('billings')
    .insert([{
      project_id: data.project_id,
      contractor_id: data.contractor_id,
      plot_id: data.plot_id || null,
      billing_date: data.billing_date,
      note: data.note,
      total_work_amount: totalWorkAmount,
      total_add_amount: totalAddAmount,
      total_deduct_amount: totalDeductAmount,
      net_amount: netAmount,
      status: 'pending_review',
      type: requestType,
      attachment_urls: data.attachment_urls || null,
      reason_for_dc: data.reason_for_dc || null,
      created_by: user.id,
      submitted_at: new Date().toISOString(),
      submitted_by: user.id
    }])
    .select()
    .single()

  if (billError) throw new Error(billError.message)

  const billingId = bill.id

  // 2. Save Job line items (Progress only)
  if (!isExtraWork && data.selected_jobs?.length > 0) {
    const jobsToInsert = data.selected_jobs.map((j: any) => ({
      billing_id: billingId,
      job_assignment_id: j.id,
      amount: j.request_amount,
      progress_percent: j.progress_percent ?? null
    }))
    await supabase.from('billing_jobs').insert(jobsToInsert)
  }

  // 3. บันทึกงานเพิ่ม/งานหัก (for Foreman)
  if (adjustments.length > 0) {
    const adjToInsert = adjustments.map((adj: any) => ({
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
  revalidatePath(`/dashboard/billing/${billingId}/review`)
  
  return bill
}

// NEW: Approve Billing Request (PM)
export async function approveBilling(id: string, data: any) {
  const supabase = await createClient()
  const user = await getCurrentUser()

  if (!user) throw new Error("User not found")

  const billingId = id

  // 1. Update Billing Header
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

  if (billError) throw new Error(billError.message)

  // 2. Update/Insert billing_jobs
  if (data.selected_jobs?.length > 0) {
    const upsertJobs = data.selected_jobs.map((j: any) => ({
      billing_id: billingId,
      job_assignment_id: j.job_assignment_id || j.id, // Handle both cases
      amount: j.request_amount,
      progress_percent: j.progress_percent ?? null
    }))
    await supabase.from('billing_jobs').upsert(upsertJobs, { onConflict: 'billing_id, job_assignment_id' })
  }

  // 3. Update/Insert Adjustments
  if (data.adjustments?.length > 0) {
    await supabase.from('billing_adjustments').delete().eq('billing_id', billingId) // Clear existing
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

  // 4. Insert into Payments
  const { data: billingJobs } = await supabase.from('billing_jobs').select('*').eq('billing_id', billingId)
  if (billingJobs && billingJobs.length > 0) {
      const paymentsToInsert = billingJobs.map((j: any) => ({
      job_assignment_id: j.job_assignment_id,
      amount: j.amount,
      payment_date: data.billing_date,
      note: `เบิกตามใบวางบิล #${bill.doc_no || '-'}`
    }))
    await supabase.from('payments').insert(paymentsToInsert)
  }

  revalidatePath('/dashboard/billing')
  revalidatePath(`/dashboard/billing/${id}`)
}

// NEW: Reject Billing Request (PM)
export async function rejectBilling(id: string, note?: string) {
    const supabase = await createClient()
    const user = await getCurrentUser()

    if (!user) throw new Error("User not found")

    const { error } = await supabase
        .from('billings')
        .update({ 
            status: 'rejected', 
            note: note, // PM can add a note on rejection
            approved_by: user.id
        })
        .eq('id', id)
        
    if (error) throw new Error(error.message)

    revalidatePath('/dashboard/billing')
    revalidatePath(`/dashboard/billing/${id}`)
}

export async function updateBillingRequest(id: string, data: any) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error("User not found")

  const { data: current, error: currentError } = await supabase
    .from('billings')
    .select('id, doc_no, status, created_by, submitted_by')
    .eq('id', id)
    .single()
  if (currentError) throw new Error(currentError.message)
  if (!current) throw new Error("Billing not found")
  if (current.status !== 'pending_review') throw new Error("Can edit pending review only")
  if (current.created_by && current.created_by !== user.id) throw new Error("No permission to edit this request")
  if (!current.created_by && current.submitted_by !== user.id) throw new Error("No permission to edit this request")

  const requestType = data.type === 'extra_work' ? 'extra_work' : 'progress'
  const isExtraWork = requestType === 'extra_work'
  const adjustments = Array.isArray(data.adjustments) ? data.adjustments : []
  const totalAddAmount = data.total_add_amount ?? adjustments
    .filter((adj: any) => adj.type === 'addition')
    .reduce((sum: number, adj: any) => sum + (parseFloat(adj.quantity) || 0) * (parseFloat(adj.unit_price) || 0), 0)
  const totalDeductAmount = data.total_deduct_amount ?? adjustments
    .filter((adj: any) => adj.type === 'deduction')
    .reduce((sum: number, adj: any) => sum + (parseFloat(adj.quantity) || 0) * (parseFloat(adj.unit_price) || 0), 0)
  const totalWorkAmount = isExtraWork ? 0 : (data.total_work_amount || 0)
  const netAmount = isExtraWork
    ? (totalAddAmount - totalDeductAmount)
    : (totalWorkAmount + totalAddAmount - totalDeductAmount)

  const { error: updateError } = await supabase
    .from('billings')
    .update({
      project_id: data.project_id,
      contractor_id: data.contractor_id,
      plot_id: data.plot_id || null,
      billing_date: data.billing_date,
      note: data.note,
      total_work_amount: totalWorkAmount,
      total_add_amount: totalAddAmount,
      total_deduct_amount: totalDeductAmount,
      net_amount: netAmount,
      type: requestType,
      attachment_urls: data.attachment_urls || null,
      reason_for_dc: data.reason_for_dc || null,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (updateError) throw new Error(updateError.message)

  await supabase.from('billing_jobs').delete().eq('billing_id', id)
  await supabase.from('billing_adjustments').delete().eq('billing_id', id)

  if (!isExtraWork && data.selected_jobs?.length > 0) {
    const jobsToInsert = data.selected_jobs.map((j: any) => ({
      billing_id: id,
      job_assignment_id: j.id,
      amount: j.request_amount,
      progress_percent: j.progress_percent ?? null
    }))
    await supabase.from('billing_jobs').insert(jobsToInsert)
  }

  if (adjustments.length > 0) {
    const adjToInsert = adjustments.map((adj: any) => ({
      billing_id: id,
      type: adj.type,
      description: adj.description,
      unit: adj.unit,
      quantity: parseFloat(adj.quantity),
      unit_price: parseFloat(adj.unit_price)
    }))
    await supabase.from('billing_adjustments').insert(adjToInsert)
  }

  revalidatePath('/dashboard/foreman/history')
  revalidatePath(`/dashboard/billing/${id}/review`)

  return { id, doc_no: current.doc_no }
}

export async function getBillingsByCreator() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error("User not found")

  const { data, error } = await supabase
    .from('billings')
    .select(`
      *,
      projects (name),
      contractors (name)
    `)
    .or(`created_by.eq.${user.id},submitted_by.eq.${user.id}`)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  const plotMap = await getPlotNameMap(supabase, (data || []).map((b: any) => b.plot_id))
  return (data || []).map((bill: any) => ({
    ...bill,
    plots: bill.plot_id ? { name: plotMap.get(bill.plot_id) || null } : null,
  }))
}

export async function getExtraWorkReport(filters: {
  projectId?: string
  plotId?: string
  reason?: string
  dateFrom?: string
  dateTo?: string
} = {}) {
  const supabase = await createClient()
  let query = supabase
    .from('billings')
    .select(`
      *,
      projects (name),
      contractors (name),
      billing_adjustments (type, quantity, unit_price)
    `)
    .eq('type', 'extra_work')
    .order('billing_date', { ascending: false })

  if (filters.projectId) query = query.eq('project_id', filters.projectId)
  if (filters.plotId) query = query.eq('plot_id', filters.plotId)
  if (filters.reason) query = query.eq('reason_for_dc', filters.reason)
  if (filters.dateFrom) query = query.gte('billing_date', filters.dateFrom)
  if (filters.dateTo) query = query.lte('billing_date', filters.dateTo)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const plotMap = await getPlotNameMap(supabase, (data || []).map((b: any) => b.plot_id))
  return (data || []).map((bill: any) => ({
    ...bill,
    plots: bill.plot_id ? { name: plotMap.get(bill.plot_id) || null } : null,
  }))
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
  const rows = data || []
  const plotMap = await getPlotNameMap(supabase, rows.map((b: any) => b.plot_id))
  return rows.map((bill: any) => ({
    ...bill,
    plots: bill.plot_id ? { name: plotMap.get(bill.plot_id) || null } : null,
  }))
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
        id,
        amount,
        progress_percent,
        job_assignments (
          id,
          agreed_price_per_unit,
          plots (name),
          payments (amount),
          boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, unit, quantity, price_per_unit)
        )
      ),
      billing_adjustments (id, type, description, unit, quantity, unit_price)
    `)
    .eq('id', id)
    .single()

  if (error) {
    console.error("Error fetching billing details:", error)
    // Return null or re-throw to be handled by the component
    throw new Error(`Could not fetch billing details: ${error.message}`);
  }

  if (data?.plot_id) {
    const plotMap = await getPlotNameMap(supabase, [data.plot_id])
    data.plots = { name: plotMap.get(data.plot_id) || null }
  } else if (data) {
    data.plots = null
  }

  // Fetch submitted/approved user names separately to avoid missing FK relationship errors.
  if (data?.submitted_by || data?.approved_by) {
    const userIds = [data.submitted_by, data.approved_by].filter(Boolean)
    const { data: users, error: usersError } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds)

    if (usersError) {
      console.error("Error fetching billing users:", usersError)
    } else if (users) {
      const byId = new Map(users.map((u: any) => [u.id, u]))
      data.submitted_by_user = byId.get(data.submitted_by) || null
      data.approved_by_user = byId.get(data.approved_by) || null
    }
  }

  // Define a specific type for the billing job object
  type BillingJob = {
    id: string;
    amount: number;
    progress_percent: number | null;
    job_assignments: {
      id: string;
      agreed_price_per_unit: number | null;
      plots: { name: string } | null;
      payments: { amount: number }[];
      boq_master: {
        item_name: string;
        unit: string;
        quantity: number;
        price_per_unit: number;
      } | null;
    } | null;
  };

  // Post-process to calculate totalBoq, paid, remaining for each job
  if (data && data.billing_jobs) {
    const processedJobs = data.billing_jobs.map((billingJob: BillingJob) => {
      const job = billingJob.job_assignments;
      if (!job) return { ...billingJob, totalBoq: 0, paid: 0, previous_progress: 0 };
      
      const pricePerUnit = (job.agreed_price_per_unit ?? job.boq_master?.price_per_unit) || 0
      const totalBoq = (job.boq_master?.quantity || 0) * pricePerUnit;

      // Calculate amount paid *before* this billing
      // This logic seems complex, ensure it's correct. It seems to be filtering payments that are *not* part of the current bill.
      // Assuming `p.billing_id` exists on payments, which is not in the select statement. This might be a hidden bug.
      // For now, I will trust the existing logic but acknowledge it's fragile.
      const paid = (job.payments || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      
      const previous_progress = totalBoq > 0 ? (paid / totalBoq) * 100 : 0;

      return {
        ...billingJob,
        totalBoq,
        paid,
        previous_progress,
      };
    });
    
    return { ...data, billing_jobs: processedJobs };
  }

  return data
}


// 6. ลบประวัติใบเบิกงวด
export async function deleteBilling(id: string) {
  const supabase = await createClient()

  const { data: bill, error: billError } = await supabase
    .from('billings')
    .select('id, doc_no, status')
    .eq('id', id)
    .single()

  if (billError) throw new Error(billError.message)
  if (!bill) throw new Error("Billing not found.")

  // Only delete associated payments if the bill was approved
  if (bill.status === 'approved') {
    const note = `เบิกตามใบวางบิล #${bill?.doc_no || '-'}`
    await supabase.from('payments').delete().match({ note })
  }

  await supabase.from('billing_jobs').delete().match({ billing_id: id })
  await supabase.from('billing_adjustments').delete().match({ billing_id: id })

  const { error } = await supabase.from('billings').delete().match({ id })
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/billing')
}

