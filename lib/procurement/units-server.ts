import type { SupabaseClient } from '@supabase/supabase-js'
import type { UnitConversions } from '@/lib/procurement/units'

/** Stored conversions for the given materials, for server code that already holds a client. */
export async function loadUnitConversions(supabase: SupabaseClient, materialTypeIds: number[]): Promise<UnitConversions> {
  const ids = [...new Set(materialTypeIds.filter((n) => Number.isFinite(n)))]
  if (ids.length === 0) return {}
  const { data, error } = await supabase
    .from('material_unit_conversions')
    .select('material_type_id, unit, factor')
    .in('material_type_id', ids)
  if (error) return {}
  const out: UnitConversions = {}
  for (const r of data || []) {
    const id = Number(r.material_type_id)
    out[id] = { ...(out[id] || {}), [String(r.unit)]: Number(r.factor) }
  }
  return out
}
