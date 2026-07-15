'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { getCurrentUser, getCurrentUserRole, requireAuthRole } from '@/actions/_shared/user-role'
import type { BoqMaterialItem, MaterialType, MaterialUsageLogEntry, MaterialVariance } from '@/lib/types/materials'

// ---------------------------------------------------------------------------
// Material catalog (PM/admin manage; anyone with `materials` access can read)
// ---------------------------------------------------------------------------

export async function getMaterialTypes(): Promise<MaterialType[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()
  const { data, error } = await supabase.from('material_types').select('*').order('name')
  if (error) throw new Error(error.message)
  return data || []
}

export async function createMaterialType(name: string, unit: string, currentPrice: number) {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const user = await getCurrentUser()

  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('Material name is required')

  const { error } = await supabase.from('material_types').insert([
    {
      name: trimmedName,
      unit: unit.trim() || 'unit',
      current_price: Math.max(0, Number(currentPrice) || 0),
      price_updated_at: new Date().toISOString(),
      price_updated_by: user?.id ?? null,
    },
  ])

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/materials')
}

/** Updates name/unit. Use `updateMaterialPrice` to change the price so the
 * price_updated_at/by audit fields only change on an actual price update. */
export async function updateMaterialType(id: number, name: string, unit: string) {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()

  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('Material name is required')

  const { error } = await supabase
    .from('material_types')
    .update({ name: trimmedName, unit: unit.trim() || 'unit' })
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/materials')
}

export async function updateMaterialPrice(id: number, currentPrice: number) {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const user = await getCurrentUser()

  const { error } = await supabase
    .from('material_types')
    .update({
      current_price: Math.max(0, Number(currentPrice) || 0),
      price_updated_at: new Date().toISOString(),
      price_updated_by: user?.id ?? null,
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/materials')
}

export async function deleteMaterialType(id: number) {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const { error } = await supabase.from('material_types').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/settings/materials')
}

// ---------------------------------------------------------------------------
// Planned materials per BOQ job (the "budget" side, PM/admin manage)
// ---------------------------------------------------------------------------

export async function getBoqMaterialItems(boqId: string): Promise<BoqMaterialItem[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('boq_material_items')
    .select('*, material_types (*)')
    .eq('boq_id', boqId)
    .order('created_at')

  if (error) throw new Error(error.message)
  return data || []
}

export async function addBoqMaterialItem(boqId: string, materialTypeId: number, plannedQuantity: number) {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()

  const { error } = await supabase.from('boq_material_items').insert([
    {
      boq_id: boqId,
      material_type_id: materialTypeId,
      planned_quantity: Math.max(0, Number(plannedQuantity) || 0),
    },
  ])

  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/boq/${boqId}`)
}

export async function updateBoqMaterialItem(id: string, boqId: string, plannedQuantity: number) {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()

  const { error } = await supabase
    .from('boq_material_items')
    .update({ planned_quantity: Math.max(0, Number(plannedQuantity) || 0) })
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/boq/${boqId}`)
}

export async function deleteBoqMaterialItem(id: string, boqId: string) {
  await requireAuthRole(['admin', 'pm'])
  const supabase = await createClient()
  const { error } = await supabase.from('boq_material_items').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath(`/dashboard/boq/${boqId}`)
}

// ---------------------------------------------------------------------------
// Actual usage log (the "actual" side, foreman logs against their own jobs)
// ---------------------------------------------------------------------------

export async function getMaterialUsageForJob(jobAssignmentId: string): Promise<MaterialUsageLogEntry[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('material_usage_log')
    .select('*, material_types (*)')
    .eq('job_assignment_id', jobAssignmentId)
    .order('purchase_date', { ascending: false })

  if (error) throw new Error(error.message)
  return data || []
}

export async function logMaterialUsage(input: {
  job_assignment_id: string
  material_type_id: number
  quantity_used: number
  unit_price_at_use: number
  purchase_date: string
  note?: string
  photo_url?: string
}) {
  await requireModuleAccess('materials')
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')

  if (!input.job_assignment_id) throw new Error('Job is required')
  if (!input.material_type_id) throw new Error('Material is required')
  if (!(Number(input.quantity_used) > 0)) throw new Error('Quantity must be greater than 0')

  const { error } = await supabase.from('material_usage_log').insert([
    {
      job_assignment_id: input.job_assignment_id,
      material_type_id: input.material_type_id,
      quantity_used: Number(input.quantity_used),
      // Snapshot the price at the moment of logging - never re-derive this
      // from material_types.current_price later, or past spend would drift
      // whenever purchasing updates the catalog price.
      unit_price_at_use: Math.max(0, Number(input.unit_price_at_use) || 0),
      purchase_date: input.purchase_date || new Date().toISOString().split('T')[0],
      note: input.note?.trim() || null,
      photo_url: input.photo_url || null,
      logged_by: user.id,
    },
  ])

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/foreman')
}

export async function updateMaterialUsageEntry(
  id: string,
  input: { quantity_used: number; unit_price_at_use: number; purchase_date: string; note?: string }
) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')
  const role = await getCurrentUserRole(supabase, user.id)

  const { data: entry, error: fetchError } = await supabase
    .from('material_usage_log')
    .select('logged_by')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) throw new Error(fetchError.message)
  if (!entry) throw new Error('Entry not found')

  const isOwner = entry.logged_by === user.id
  const isPrivileged = role === 'pm' || role === 'admin'
  if (!isOwner && !isPrivileged) throw new Error('No permission to edit this entry')

  if (!(Number(input.quantity_used) > 0)) throw new Error('Quantity must be greater than 0')

  const { error } = await supabase
    .from('material_usage_log')
    .update({
      quantity_used: Number(input.quantity_used),
      unit_price_at_use: Math.max(0, Number(input.unit_price_at_use) || 0),
      purchase_date: input.purchase_date,
      note: input.note?.trim() || null,
    })
    .eq('id', id)

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/foreman')
}

export async function deleteMaterialUsageEntry(id: string) {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')
  const role = await getCurrentUserRole(supabase, user.id)

  const { data: entry, error: fetchError } = await supabase
    .from('material_usage_log')
    .select('logged_by')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) throw new Error(fetchError.message)
  if (!entry) throw new Error('Entry not found')

  const isOwner = entry.logged_by === user.id
  const isPrivileged = role === 'pm' || role === 'admin'
  if (!isOwner && !isPrivileged) throw new Error('No permission to delete this entry')

  const { error } = await supabase.from('material_usage_log').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/foreman')
}

// ---------------------------------------------------------------------------
// Planned-vs-actual rollup for one job assignment (a BOQ job on one plot)
// ---------------------------------------------------------------------------

export async function getMaterialVarianceForJob(jobAssignmentId: string): Promise<MaterialVariance[]> {
  await requireModuleAccess('materials')
  const supabase = await createClient()

  const { data: jobAssignment, error: jobError } = await supabase
    .from('job_assignments')
    .select('boq_item_id')
    .eq('id', jobAssignmentId)
    .maybeSingle()

  if (jobError) throw new Error(jobError.message)
  if (!jobAssignment?.boq_item_id) return []

  const [{ data: planned, error: plannedError }, { data: actual, error: actualError }] = await Promise.all([
    supabase
      .from('boq_material_items')
      .select('material_type_id, planned_quantity, material_types (id, name, unit, current_price)')
      .eq('boq_id', jobAssignment.boq_item_id),
    supabase
      .from('material_usage_log')
      .select('material_type_id, quantity_used, unit_price_at_use')
      .eq('job_assignment_id', jobAssignmentId),
  ])

  if (plannedError) throw new Error(plannedError.message)
  if (actualError) throw new Error(actualError.message)

  const actualByMaterial = new Map<number, { quantity: number; cost: number }>()
  for (const row of actual || []) {
    const existing = actualByMaterial.get(row.material_type_id) || { quantity: 0, cost: 0 }
    existing.quantity += Number(row.quantity_used || 0)
    existing.cost += Number(row.quantity_used || 0) * Number(row.unit_price_at_use || 0)
    actualByMaterial.set(row.material_type_id, existing)
  }

  const plannedByMaterial = new Map<
    number,
    { planned_quantity: number; material_type: { id: number; name: string; unit: string; current_price: number } | null }
  >()
  for (const row of planned || []) {
    const materialType = Array.isArray(row.material_types) ? row.material_types[0] : row.material_types
    plannedByMaterial.set(row.material_type_id, {
      planned_quantity: Number(row.planned_quantity || 0),
      material_type: materialType ?? null,
    })
  }

  // Union of planned + actual material ids - a material logged without being
  // pre-planned (e.g. something unexpected was bought) must still show up
  // here, not silently disappear from the comparison.
  const allMaterialIds = new Set<number>([...plannedByMaterial.keys(), ...actualByMaterial.keys()])

  // Materials that only appear in `actual` have no joined material_types row
  // from the `planned` query, so look those up separately.
  const unplannedIds = Array.from(allMaterialIds).filter((id) => !plannedByMaterial.has(id))
  const unplannedTypes = unplannedIds.length
    ? (
        await supabase
          .from('material_types')
          .select('id, name, unit, current_price')
          .in('id', unplannedIds)
      ).data || []
    : []
  const unplannedTypeById = new Map(unplannedTypes.map((t) => [t.id, t]))

  return Array.from(allMaterialIds).map((materialTypeId) => {
    const plannedEntry = plannedByMaterial.get(materialTypeId)
    const materialType = plannedEntry?.material_type ?? unplannedTypeById.get(materialTypeId) ?? null
    const plannedQuantity = plannedEntry?.planned_quantity ?? 0
    const plannedCost = plannedQuantity * Number(materialType?.current_price || 0)
    const usedEntry = actualByMaterial.get(materialTypeId) || { quantity: 0, cost: 0 }

    return {
      material_type_id: materialTypeId,
      material_name: materialType?.name || 'ไม่ระบุ',
      unit: materialType?.unit || 'unit',
      planned_quantity: plannedQuantity,
      used_quantity: usedEntry.quantity,
      planned_cost: plannedCost,
      actual_cost: usedEntry.cost,
      difference: usedEntry.cost - plannedCost,
    }
  })
}
