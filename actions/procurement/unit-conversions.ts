'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getDashboardSession } from '@/lib/auth/route-access'
import { translateError } from '@/lib/errors'
import type { UnitConversions } from '@/lib/procurement/units'
import { loadUnitConversions } from '@/lib/procurement/units-server'

const READ_ROLES = ['admin', 'pm', 'foreman']

/** Every stored conversion for the given materials (any staff role may read). */
export async function getUnitConversions(materialTypeIds: number[]): Promise<UnitConversions> {
  const { user, role } = await getDashboardSession()
  if (!user || !READ_ROLES.includes(role)) return {}
  const ids = [...new Set(materialTypeIds.filter((n) => Number.isFinite(n)))]
  if (ids.length === 0) return {}
  const supabase = await createClient()
  return loadUnitConversions(supabase, ids)
}

/** Purchasing (admin/pm) types "1 มัด = 10 เส้น" once; every screen reuses it. */
export async function setUnitConversion(materialTypeId: number, unit: string, factor: number): Promise<{ ok: true } | { error: string }> {
  const { user, role } = await getDashboardSession()
  if (!user) return { error: 'กรุณาเข้าสู่ระบบ' }
  if (role !== 'admin' && role !== 'pm') return { error: 'เฉพาะแอดมินหรือ PM ที่บันทึกการแปลงหน่วยได้' }
  if (!(factor > 0) || !Number.isFinite(factor)) return { error: 'จำนวนต่อหน่วยต้องมากกว่า 0' }
  const supabase = await createClient()
  const { error } = await supabase.rpc('material_unit_conversion_set', {
    p_material_type_id: materialTypeId,
    p_unit: unit.trim(),
    p_factor: factor,
  })
  if (error) return { error: translateError(error.message) }
  return { ok: true }
}

/**
 * A material that still has the placeholder unit ("unit") learns its real one
 * from the first order written in a real unit.
 *
 * - `unit` is the small unit the material is counted in (stock, BOQ, request).
 * - `pack` (optional): the order was written in a bigger unit, e.g. "1 ลัง = 12 ตัว"
 *   -> packUnit 'ลัง', smallPerPack 12. The conversion is stored too, so every
 *   later order, receipt and BOQ check converts by itself.
 *
 * Only ever fills the placeholder: a material that already has a real unit is
 * left exactly as it is (the update is guarded, so two people ordering at the
 * same moment cannot overwrite each other either).
 */
export async function learnMaterialUnit(
  materialTypeId: number,
  unit: string,
  pack?: { packUnit: string; smallPerPack: number }
): Promise<{ ok: true; unit: string } | { error: string }> {
  const { user, role } = await getDashboardSession()
  if (!user) return { error: 'กรุณาเข้าสู่ระบบ' }
  if (role !== 'admin' && role !== 'pm') return { error: 'เฉพาะแอดมินหรือ PM ที่กำหนดหน่วยวัสดุได้' }
  const small = unit.trim()
  if (!small || small.toLowerCase() === 'unit') return { error: 'กรุณาระบุหน่วย' }
  const packUnit = pack?.packUnit.trim() ?? ''
  if (pack) {
    if (!packUnit || packUnit === small) return { error: 'หน่วยแพ็คต้องต่างจากหน่วยเล็ก' }
    if (!(pack.smallPerPack > 0) || !Number.isFinite(pack.smallPerPack)) return { error: 'จำนวนต่อแพ็คต้องมากกว่า 0' }
  }

  const supabase = await createClient()

  // A stored conversion for the very unit we are about to call the base unit
  // would be silently ignored from then on (the base unit always counts 1:1),
  // so refuse when it says something other than 1.
  const { data: existing, error: readError } = await supabase
    .from('material_unit_conversions')
    .select('unit, factor')
    .eq('material_type_id', materialTypeId)
  if (readError) return { error: translateError(readError.message) }
  const clash = (existing || []).find((c) => String(c.unit).trim() === small && Number(c.factor) !== 1)
  if (clash) return { error: `วัสดุนี้มีการแปลงหน่วยของ "${small}" ไว้แล้ว (ไม่ใช่ 1:1) ให้ PM ตรวจที่หน้าวัสดุก่อน` }

  const { data: updated, error } = await supabase
    .from('material_types')
    .update({ unit: small })
    .eq('id', materialTypeId)
    .in('unit', ['unit', ''])
    .select('id')
  if (error) return { error: translateError(error.message) }
  if (!updated || updated.length === 0) return { error: 'วัสดุนี้มีหน่วยอยู่แล้ว จึงไม่ได้เปลี่ยน' }

  if (pack) {
    // Stored as "how many of the pack unit make 1 base unit".
    const factor = Math.round((1 / pack.smallPerPack) * 1e12) / 1e12
    const { error: convError } = await supabase.rpc('material_unit_conversion_set', {
      p_material_type_id: materialTypeId,
      p_unit: packUnit,
      p_factor: factor,
    })
    if (convError) return { error: `จำหน่วย ${small} แล้ว แต่ยังจำการแปลง ${packUnit} ไม่ได้: ${translateError(convError.message)}` }
  }
  revalidatePath('/dashboard/settings/materials')
  return { ok: true, unit: small }
}
