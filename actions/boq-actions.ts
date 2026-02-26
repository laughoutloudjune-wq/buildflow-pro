'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// --- HOUSE MODELS (แบบบ้าน) ---

export async function getHouseModels() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('house_models')
    .select(`*, projects (name)`)
    .order('name', { ascending: true })
  
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
  const formProjectId = formData.get('project_id') as string
  const item_name = formData.get('item_name') as string
  const contractor_type_id = formData.get('contractor_type_id') as string
  const unit = formData.get('unit') as string
  const quantity = formData.get('quantity') as string
  const price_per_unit = formData.get('price_per_unit') as string

  if (!item_name || !house_model_id) return

  const { data: model, error: modelError } = await supabase
    .from('house_models')
    .select('project_id')
    .eq('id', house_model_id)
    .maybeSingle()

  if (modelError) throw new Error(modelError.message)

  const project_id = formProjectId || model?.project_id
  if (!project_id) {
    throw new Error('House model is missing project. Please set project on this house model first.')
  }

  const { error } = await supabase.from('boq_master').insert([{
    project_id,
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

export async function updateBOQItem(id: string, formData: FormData) {
  const supabase = await createClient()
  const house_model_id = formData.get('house_model_id') as string
  const formProjectId = formData.get('project_id') as string
  const item_name = formData.get('item_name') as string
  const contractor_type_id = formData.get('contractor_type_id') as string
  const unit = formData.get('unit') as string
  const quantity = formData.get('quantity') as string
  const price_per_unit = formData.get('price_per_unit') as string

  if (!id || !item_name || !house_model_id) return

  const { data: model, error: modelError } = await supabase
    .from('house_models')
    .select('project_id')
    .eq('id', house_model_id)
    .maybeSingle()

  if (modelError) throw new Error(modelError.message)

  const project_id = formProjectId || model?.project_id
  if (!project_id) {
    throw new Error('House model is missing project. Please set project on this house model first.')
  }

  const { error } = await supabase
    .from('boq_master')
    .update({
      project_id,
      house_model_id,
      item_name,
      contractor_type_id: parseInt(contractor_type_id),
      unit,
      quantity: parseFloat(quantity || '0'),
      price_per_unit: parseFloat(price_per_unit || '0'),
    })
    .match({ id })

  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/boq/${house_model_id}`)
}

type ImportBOQPayload = {
  target_model_id: string
  source_model_id: string
  items: Array<{
    source_item_id: string
    price_per_unit: number
  }>
}

export async function importBOQItems(payload: ImportBOQPayload) {
  const supabase = await createClient()

  if (!payload?.target_model_id || !payload?.source_model_id) {
    throw new Error('Missing source or target model')
  }

  if (payload.target_model_id === payload.source_model_id) {
    throw new Error('Source and target house model must be different')
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return
  }

  const sourceIds = payload.items.map((item) => item.source_item_id).filter(Boolean)

  const { data: targetModel, error: targetModelError } = await supabase
    .from('house_models')
    .select('id, project_id')
    .eq('id', payload.target_model_id)
    .maybeSingle()

  if (targetModelError) throw new Error(targetModelError.message)
  if (!targetModel?.project_id) {
    throw new Error('Target house model is missing project. Please set project first.')
  }

  const { data: sourceItems, error: sourceItemsError } = await supabase
    .from('boq_master')
    .select('id, item_name, contractor_type_id, unit, quantity')
    .eq('house_model_id', payload.source_model_id)
    .in('id', sourceIds)

  if (sourceItemsError) throw new Error(sourceItemsError.message)

  const priceById = new Map(payload.items.map((item) => [item.source_item_id, Number(item.price_per_unit || 0)]))

  const { data: existingTargetItems, error: existingError } = await supabase
    .from('boq_master')
    .select('item_name, contractor_type_id, unit')
    .eq('house_model_id', payload.target_model_id)

  if (existingError) throw new Error(existingError.message)

  const existingKeys = new Set(
    (existingTargetItems || []).map((row) => `${row.item_name}::${row.contractor_type_id || ''}::${row.unit || ''}`)
  )

  const rowsToInsert = (sourceItems || [])
    .map((item) => ({
    project_id: targetModel.project_id,
    house_model_id: payload.target_model_id,
    item_name: item.item_name,
    contractor_type_id: item.contractor_type_id,
    unit: item.unit,
    quantity: item.quantity || 0,
    price_per_unit: priceById.get(item.id) || 0,
    }))
    .filter((row) => !existingKeys.has(`${row.item_name}::${row.contractor_type_id || ''}::${row.unit || ''}`))

  if (rowsToInsert.length === 0) return

  const { error: insertError } = await supabase.from('boq_master').insert(rowsToInsert)
  if (insertError) throw new Error(insertError.message)

  revalidatePath(`/dashboard/boq/${payload.target_model_id}`)
}
