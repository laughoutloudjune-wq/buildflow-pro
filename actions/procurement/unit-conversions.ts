'use server'

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
