'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess } from '@/lib/auth/route-access'

// ดึงโครงการทั้งหมด
// includeOverhead: รวมหมวดเบิกใช้ภายใน (kind='overhead' - สโตร์กลาง, ของใช้สำนักงาน,
// อุปกรณ์ช่าง ฯลฯ) ด้วยหรือไม่ - ค่าเริ่มต้นไม่รวม เพราะหน้าจัดการโครงการ/แดชบอร์ด
// ไม่ควรนับหรือแสดงมันปนกับโครงการพัฒนาจริง มีแค่ฟอร์ม PO/PR ที่ต้องรวมไว้ให้เลือก
// ซื้อเข้าสโตร์กลาง/หมวดภายในได้
// onlyProjectsPage: จำกัดเฉพาะโครงการที่ตั้งค่า show_on_projects_page=true (โครงการพัฒนาจริง)
// ใช้กับหน้ารายการโครงการ/BOQ ที่ไม่ควรปนกับงานเดี่ยว/หมวดเบิกใช้ภายในที่ผูกกับ PO เก่า
export async function getProjects(opts: { includeOverhead?: boolean; onlyProjectsPage?: boolean } = {}) {
  const supabase = await createClient()
  let query = supabase
    .from('projects')
    .select('*')
    .order('location', { ascending: true })
    .order('name', { ascending: true })
  if (!opts.includeOverhead) query = query.eq('kind', 'development')
  if (opts.onlyProjectsPage) query = query.eq('show_on_projects_page', true)

  const { data, error } = await query

  // ✅ วิธีเช็ค Error ที่ปลอดภัยที่สุด
  if (error) {
    console.error("Error fetching projects:", error) // Log error ลงใน Terminal
    throw new Error(error.message)
  }

  return data
}

export type ProjectProgress = {
  plotsWithJobs: number
  jobsTotal: number
  jobsDone: number
  progressPercent: number
}

/** Value-weighted construction progress per project (see the
 * get_projects_progress SQL function). Projects without jobs are absent. */
export async function getProjectsProgress(): Promise<Record<string, ProjectProgress>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_projects_progress')
  if (error) {
    console.error('Error fetching project progress:', error)
    return {}
  }
  const out: Record<string, ProjectProgress> = {}
  for (const row of (data || []) as Array<{ project_id: string; plots_with_jobs: number; jobs_total: number; jobs_done: number; progress_percent: number | string }>) {
    out[row.project_id] = {
      plotsWithJobs: row.plots_with_jobs,
      jobsTotal: row.jobs_total,
      jobsDone: row.jobs_done,
      progressPercent: Number(row.progress_percent) || 0,
    }
  }
  return out
}

// ดึงโครงการรายตัว (Get By ID)
export async function getProjectById(id: string) {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle() // ใช้ maybeSingle เพื่อความปลอดภัย (คืนค่า null ถ้าไม่เจอ)
  
  if (error) {
    console.error(`Error fetching project ${id}:`, error)
    throw new Error(error.message)
  }

  return data
}

// สร้างโครงการ
export async function createProject(formData: FormData) {
  await requireModuleAccess('projects')
  const supabase = await createClient()
  const name = formData.get('name') as string
  const location = formData.get('location') as string

  if (!name) return

  const { error } = await supabase
    .from('projects')
    .insert([{ name, location, status: 'active' }])

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/projects')
}

// สลับสถานะโครงการ (กำลังดำเนินการ / ปิดโครงการแล้ว) - ใช้ toggle บนหน้ารายการ
export async function setProjectStatus(id: string, status: 'active' | 'completed') {
  await requireModuleAccess('projects')
  const supabase = await createClient()
  const { error } = await supabase.from('projects').update({ status }).match({ id })

  if (error) {
    throw new Error(error.message)
  }
  revalidatePath('/dashboard/projects')
}

// ลบโครงการ
export async function deleteProject(id: string) {
  await requireModuleAccess('projects')
  const supabase = await createClient()
  const { error } = await supabase.from('projects').delete().match({ id })

  if (error) {
    throw new Error(error.message)
  }
  revalidatePath('/dashboard/projects')
}

// อัปเดตโครงการ
export async function updateProject(id: string, formData: FormData) {
  await requireModuleAccess('projects')
  const supabase = await createClient()
  const name = formData.get('name') as string
  const location = formData.get('location') as string
  // Empty textarea means "no preset" rather than an empty note, so it's
  // stored as null - the PO form treats null and '' the same, but null keeps
  // "never set" distinguishable in the data.
  const deliveryAddress = ((formData.get('delivery_address') as string) || '').trim()

  if (!name) return

  const { error } = await supabase
    .from('projects')
    .update({ name, location, delivery_address: deliveryAddress || null })
    .match({ id })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/projects')
  revalidatePath(`/dashboard/projects/${id}`)
  // The PO form reads this preset from its project list, so a stale cache
  // there would keep prefilling the old address.
  revalidatePath('/dashboard/procurement/orders/create')
}
