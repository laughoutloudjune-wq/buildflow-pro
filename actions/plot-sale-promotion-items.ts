'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess } from '@/lib/auth/route-access'

export type PlotSalePromotionItem = {
  id: string
  name: string
  value: number
  sourcePromotionId: string | null
}

/**
 * The actual free items a specific deal is getting - seeded from a bundle
 * (see applyPromotionBundle) and/or typed in ad-hoc, since sales negotiates
 * per deal and the catalog is only ever a starting point (June, 2026-09-24).
 *
 * Deliberately NOT gated with requireModuleAccess - same reasoning as
 * getPlotSaleDetail in actions/sales-actions.ts: the plot-detail page is
 * shared with construction viewers who have no 'sales' access, and RLS
 * (admin/pm/sales only) already returns nothing for them.
 */
export async function getPlotSalePromotionItems(plotSaleId: string): Promise<PlotSalePromotionItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plot_sale_promotion_items')
    .select('id, name, value, source_promotion_id')
    .eq('plot_sale_id', plotSaleId)
    .order('created_at')

  if (error) return []
  return (data || []).map((row) => ({
    id: row.id,
    name: row.name,
    value: row.value,
    sourcePromotionId: row.source_promotion_id,
  }))
}

/** Copies a bundle's catalog items onto this deal - additive, not a
 * replace, so applying a second bundle (or one after ad-hoc edits) just
 * adds more lines rather than wiping what's there ("multiple bundle
 * promotion", June's request). */
export async function applyPromotionBundle(plotSaleId: string, promotionId: string) {
  await requireModuleAccess('sales')
  const supabase = await createClient()

  const { data: items, error: itemsError } = await supabase
    .from('promotion_items')
    .select('name, value')
    .eq('promotion_id', promotionId)

  if (itemsError) return { success: false, error: itemsError.message }
  if (!items || items.length === 0) return { success: false, error: 'โปรโมชั่นนี้ยังไม่มีรายการของแถม' }

  const { error } = await supabase.from('plot_sale_promotion_items').insert(
    items.map((item) => ({
      plot_sale_id: plotSaleId,
      source_promotion_id: promotionId,
      name: item.name,
      value: item.value,
    }))
  )
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/projects')
  revalidatePath('/dashboard/sales')
  return { success: true, count: items.length }
}

export async function addPlotSalePromotionItem(plotSaleId: string, formData: FormData) {
  const { user } = await requireModuleAccess('sales')
  const name = String(formData.get('name') || '').trim()
  const value = Number(formData.get('value') || 0)
  if (!name) return { success: false, error: 'กรุณาใส่ชื่อรายการ' }
  if (!Number.isFinite(value) || value < 0) return { success: false, error: 'มูลค่าไม่ถูกต้อง' }

  const supabase = await createClient()
  const { error } = await supabase.from('plot_sale_promotion_items').insert({
    plot_sale_id: plotSaleId,
    name,
    value,
    created_by: user?.id || null,
  })
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/projects')
  revalidatePath('/dashboard/sales')
  return { success: true }
}

export async function updatePlotSalePromotionItem(id: string, formData: FormData) {
  await requireModuleAccess('sales')
  const name = String(formData.get('name') || '').trim()
  const value = Number(formData.get('value') || 0)
  if (!name) return { success: false, error: 'กรุณาใส่ชื่อรายการ' }
  if (!Number.isFinite(value) || value < 0) return { success: false, error: 'มูลค่าไม่ถูกต้อง' }

  const supabase = await createClient()
  const { error } = await supabase.from('plot_sale_promotion_items').update({ name, value }).eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/projects')
  revalidatePath('/dashboard/sales')
  return { success: true }
}

export async function deletePlotSalePromotionItem(id: string) {
  await requireModuleAccess('sales')
  const supabase = await createClient()
  const { error } = await supabase.from('plot_sale_promotion_items').delete().eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/projects')
  revalidatePath('/dashboard/sales')
  return { success: true }
}
