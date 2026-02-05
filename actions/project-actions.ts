'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ดึงโครงการทั้งหมด
export async function getProjects() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })
  
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
  const supabase = await createClient()
  const { error } = await supabase.from('projects').delete().match({ id })

  if (error) {
    throw new Error(error.message)
  }
  revalidatePath('/dashboard/projects')
}

// อัปเดตโครงการ
export async function updateProject(id: string, formData: FormData) {
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