'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ดึงประเภทช่างทั้งหมด (สำหรับใส่ใน Dropdown)
export async function getContractorTypes() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('contractor_types').select('*').order('id')
  if (error) throw new Error(error.message)
  return data
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
  return data
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