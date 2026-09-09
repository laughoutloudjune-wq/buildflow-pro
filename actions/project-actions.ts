'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess } from '@/lib/auth/route-access'

// ดึงโครงการทั้งหมด
// includeCentralStock: รวมโครงการพิเศษ "ของเบิกสโตร์" ด้วยหรือไม่ - ค่าเริ่มต้นไม่รวม
// เพราะหน้าจัดการโครงการ/แดชบอร์ดไม่ควรนับหรือแสดงมันปนกับโครงการจริง มีแค่ฟอร์ม PO/PR
// ที่ต้องรวมไว้ให้เลือกซื้อเข้าสโตร์กลางได้
// onlyProjectsPage: จำกัดเฉพาะโครงการที่ตั้งค่า show_on_projects_page=true (โครงการพัฒนาจริง)
// ใช้กับหน้ารายการโครงการ/BOQ ที่ไม่ควรปนกับงานเดี่ยว/หมวดเบิกใช้ภายในที่ผูกกับ PO เก่า
export async function getProjects(opts: { includeCentralStock?: boolean; onlyProjectsPage?: boolean } = {}) {
  const supabase = await createClient()
  let query = supabase
    .from('projects')
    .select('*')
    .order('location', { ascending: true })
    .order('name', { ascending: true })
  if (!opts.includeCentralStock) query = query.eq('is_central_stock', false)
  if (opts.onlyProjectsPage) query = query.eq('show_on_projects_page', true)

  const { data, error } = await query

  // ✅ วิธีเช็ค Error ที่ปลอดภัยที่สุด
  if (error) {
    console.error("Error fetching projects:", error) // Log error ลงใน Terminal
    throw new Error(error.message)
  }

  return data
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

  if (!name) return

  const { error } = await supabase
    .from('projects')
    .update({ name, location })
    .match({ id })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/projects')
  revalidatePath(`/dashboard/projects/${id}`)
}
