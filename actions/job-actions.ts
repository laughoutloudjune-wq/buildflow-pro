'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ดึงข้อมูลแปลง (Plot Info)
export async function getPlotById(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plots')
    .select(`
      *,
      house_models (name, code),
      projects (name, id)
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) console.error("Error fetching plot:", error)
  return data
}

// [UPDATED] ดึงงาน + ประวัติการจ่ายเงิน
export async function getJobAssignments(plotId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('job_assignments')
    .select(`
      *,
      boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, unit, quantity, price_per_unit),
      contractors (id, name, phone),
      payments (id, amount, note, payment_date) 
    `) // เพิ่มบรรทัด payments (...) เข้าไป
    .eq('plot_id', plotId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error("Error fetching jobs:", error)
  }
  return data || []
}

// อัปเดตผู้รับเหมา (Assign Contractor)
export async function assignContractor(jobId: string, contractorId: string, plotId: string, projectId: string) {
  const supabase = await createClient()
  
  const cid = contractorId === "" ? null : contractorId

  const { error } = await supabase
    .from('job_assignments')
    .update({ 
        contractor_id: cid,
        status: cid ? 'pending' : 'pending' 
    })
    .eq('id', jobId)

  if (error) throw new Error(error.message)
  
  revalidatePath(`/dashboard/projects/${projectId}/${plotId}`)
}

// อัปเดตสถานะงาน (Update Status)
export async function updateJobStatus(jobId: string, status: string, plotId: string, projectId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('job_assignments')
    .update({ status })
    .eq('id', jobId)

  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/projects/${projectId}/${plotId}`)
}

// ฟังก์ชัน Sync (Log ละเอียด)
export async function syncPlotJobs(plotId: string, houseModelId: string, projectId: string) {
  const supabase = await createClient()

  console.log(`[SYNC START] Plot: ${plotId}, Model: ${houseModelId}`)

  // 1. ดึง BOQ Master
  const { data: boqItems, error: boqError } = await supabase
    .from('boq_master')
    .select('id, item_name') 
    .eq('house_model_id', houseModelId)

  if (boqError) {
    console.error("[SYNC ERROR] Fetch BOQ Failed:", boqError)
    throw new Error("ดึงข้อมูล BOQ ไม่สำเร็จ: " + boqError.message)
  }

  if (!boqItems || boqItems.length === 0) {
    console.warn(`[SYNC WARN] No BOQ items found for model ${houseModelId}`)
    throw new Error("แบบบ้านนี้ยังไม่มีรายการ BOQ กรุณาเพิ่มรายการที่เมนูแบบบ้านก่อน")
  }

  console.log(`[SYNC INFO] Found ${boqItems.length} items. Syncing...`)

  // 2. เตรียมข้อมูล
  const jobs = boqItems.map(item => ({
    plot_id: plotId,
    boq_item_id: item.id,
    status: 'pending'
  }))

  // 3. Upsert
  const { error: upsertError } = await supabase
    .from('job_assignments')
    .upsert(jobs, { 
      onConflict: 'plot_id, boq_item_id', 
      ignoreDuplicates: true 
    })

  if (upsertError) {
    console.error("[SYNC ERROR] Upsert Failed:", upsertError)
    throw new Error("บันทึกข้อมูลงานไม่สำเร็จ: " + upsertError.message)
  }
  
  console.log("[SYNC SUCCESS] Jobs synced successfully.")
  revalidatePath(`/dashboard/projects/${projectId}/${plotId}`)
}