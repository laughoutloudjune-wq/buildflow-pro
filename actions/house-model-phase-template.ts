'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess } from '@/lib/auth/route-access'

export type HouseModelPhaseTemplateRow = {
  contractorTypeId: number
  sequenceOrder: number
  durationDays: number
}

type TemplateRecord = { contractor_type_id: number; sequence_order: number; duration_days: number }

/** Raw template rows for this house model - the caller (BOQDetailPageClient)
 * already has the house model's BOQ items (and so which contractor_types are
 * actually in use) loaded, so this doesn't re-derive that; it just returns
 * whatever's saved. */
export async function getHouseModelPhaseTemplate(houseModelId: string): Promise<HouseModelPhaseTemplateRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('house_model_phase_template')
    .select('contractor_type_id, sequence_order, duration_days')
    .eq('house_model_id', houseModelId)
    .order('sequence_order', { ascending: true })
  if (error) throw new Error(error.message)

  return ((data || []) as TemplateRecord[]).map((t) => ({
    contractorTypeId: t.contractor_type_id,
    sequenceOrder: t.sequence_order,
    durationDays: t.duration_days,
  }))
}

export type HouseModelPhaseTemplateResult = { success: true } | { success: false; error: string }

export async function saveHouseModelPhaseTemplate(
  houseModelId: string,
  entries: HouseModelPhaseTemplateRow[]
): Promise<HouseModelPhaseTemplateResult> {
  try {
    await requireModuleAccess('boq')

    if (entries.length > 0) {
      const supabase = await createClient()
      const { error } = await supabase.from('house_model_phase_template').upsert(
        entries.map((e) => ({
          house_model_id: houseModelId,
          contractor_type_id: e.contractorTypeId,
          sequence_order: e.sequenceOrder,
          duration_days: e.durationDays,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'house_model_id,contractor_type_id' }
      )
      if (error) return { success: false, error: error.message }
    }

    revalidatePath(`/dashboard/boq/${houseModelId}`)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึกเทมเพลตแผนงาน' }
  }
}
