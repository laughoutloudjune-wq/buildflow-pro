'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ดึงประเภทช่างทั้งหมด
export async function getContractorTypes() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('contractor_types').select('*').order('id')
  if (error) throw new Error(error.message)
  return data
}

// เพิ่มประเภทช่างใหม่
export async function createContractorType(formData: FormData) {
  const supabase = await createClient()
  
  const name = formData.get('name') as string

  if (!name) return

  const { error } = await supabase
    .from('contractor_types')
    .insert([{ name }])

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/contractor-types')
}

// อัปเดตประเภทช่าง
export async function updateContractorType(id: number, formData: FormData) {
    const supabase = await createClient()
    const name = formData.get('name') as string

    if (!name) return

    const { error } = await supabase
        .from('contractor_types')
        .update({ name })
        .match({ id })

    if (error) {
        throw new Error(error.message)
    }

    revalidatePath('/dashboard/settings/contractor-types')
}


// ลบประเภทช่าง
export async function deleteContractorType(id: number) {
  const supabase = await createClient()
  const { error } = await supabase.from('contractor_types').delete().match({ id })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/contractor-types')
}
