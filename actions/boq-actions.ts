'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// --- HOUSE MODELS (แบบบ้าน) ---

export async function getHouseModels() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('house_models')
    .select(`*, projects (name)`)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error("Error fetching house models:", error)
    return [] // คืนค่าว่างดีกว่า Error
  }
  return data
}

// [UPDATED] ดึงแบบบ้านตาม ID (ใช้ maybeSingle กัน Error)
export async function getHouseModelById(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('house_models')
    .select(`*, projects (name)`)
    .eq('id', id)
    .maybeSingle() // ✅ เปลี่ยนเป็น maybeSingle

  if (error) {
    console.error(`Error fetching model ${id}:`, error)
    throw new Error(error.message)
  }
  return data
}

export async function createHouseModel(formData: FormData) {
  const supabase = await createClient()
  const name = formData.get('name') as string
  const code = formData.get('code') as string
  const area = formData.get('area') as string
  const project_id = formData.get('project_id') as string

  if (!name) return

  const { error } = await supabase.from('house_models').insert([{
    name,
    code,
    area: area ? parseFloat(area) : 0,
    project_id: project_id || null
  }])

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/boq')
}

export async function deleteHouseModel(id: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('house_models').delete().match({ id })
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/boq')
}

export async function updateHouseModel(id: string, formData: FormData) {
  const supabase = await createClient()
  const name = formData.get('name') as string
  const code = formData.get('code') as string
  const area = formData.get('area') as string
  const project_id = formData.get('project_id') as string

  if (!name) return

  const { error } = await supabase.from('house_models').update({
    name,
    code,
    area: area ? parseFloat(area) : 0,
    project_id: project_id || null
  }).match({ id })

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/boq')
  revalidatePath(`/dashboard/boq/${id}`)
}


// --- BOQ ITEMS (รายการงาน) ---

export async function getBOQItems(modelId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('boq_master')
    .select(`*, contractor_types (name)`)
    .eq('house_model_id', modelId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error(`Error fetching BOQ items for ${modelId}:`, error)
    return []
  }
  return data
}

export async function createBOQItem(formData: FormData) {
  const supabase = await createClient()
  const house_model_id = formData.get('house_model_id') as string
  const item_name = formData.get('item_name') as string
  const contractor_type_id = formData.get('contractor_type_id') as string
  const unit = formData.get('unit') as string
  const quantity = formData.get('quantity') as string
  const price_per_unit = formData.get('price_per_unit') as string

  if (!item_name || !house_model_id) return

  const { error } = await supabase.from('boq_master').insert([{
    house_model_id,
    item_name,
    contractor_type_id: parseInt(contractor_type_id),
    unit,
    quantity: parseFloat(quantity || '0'),
    price_per_unit: parseFloat(price_per_unit || '0')
  }])

  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/boq/${house_model_id}`)
}

export async function deleteBOQItem(id: string, modelId: string) {
  const supabase = await createClient()
  const { error } = await supabase.from('boq_master').delete().match({ id })
  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/boq/${modelId}`)
}