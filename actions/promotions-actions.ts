'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'

export type PromotionItem = {
  id: string
  name: string
  value: number
}

export type Promotion = {
  id: string
  name: string
  description: string | null
  isActive: boolean
  items: PromotionItem[]
}

type PromotionRow = {
  id: string
  name: string
  description: string | null
  is_active: boolean
  promotion_items: { id: string; name: string; value: number }[] | null
}

function toPromotion(row: PromotionRow): Promotion {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    items: (row.promotion_items || []).map((i) => ({ id: i.id, name: i.name, value: i.value })),
  }
}

/** Active bundles only, with their catalog items - what the plot-detail
 * "apply a bundle" picker offers. Matches getSaleStatuses' shape/gating so
 * getPlotDetailBundle can call it the same way (`.catch(() => [])`). */
export async function getPromotions(): Promise<Promotion[]> {
  await requireModuleAccess('sales')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('promotions')
    .select('id, name, description, is_active, promotion_items (id, name, value)')
    .eq('is_active', true)
    .order('name')
  if (error) throw new Error(error.message)
  return (data || []).map((row) => toPromotion(row as unknown as PromotionRow))
}

/** Catalogue management read (admin + sales, June's explicit choice - not
 * admin-only like sale_statuses) - includes inactive bundles so they can be
 * reactivated. */
export async function getAllPromotions(): Promise<Promotion[]> {
  await requireAuthRole(['admin', 'sales'], 'Only admin/sales can manage promotions')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('promotions')
    .select('id, name, description, is_active, promotion_items (id, name, value)')
    .order('name')
  if (error) throw new Error(error.message)
  return (data || []).map((row) => toPromotion(row as unknown as PromotionRow))
}

export async function createPromotion(formData: FormData) {
  await requireAuthRole(['admin', 'sales'], 'Only admin/sales can manage promotions')
  const name = String(formData.get('name') || '').trim()
  const description = String(formData.get('description') || '').trim()
  if (!name) return { success: false, error: 'กรุณาใส่ชื่อโปรโมชั่น' }

  const supabase = await createClient()
  const { error } = await supabase.from('promotions').insert({ name, description: description || null })
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/sales/promotions')
  return { success: true }
}

export async function updatePromotion(id: string, formData: FormData) {
  await requireAuthRole(['admin', 'sales'], 'Only admin/sales can manage promotions')
  const name = String(formData.get('name') || '').trim()
  const description = String(formData.get('description') || '').trim()
  if (!name) return { success: false, error: 'กรุณาใส่ชื่อโปรโมชั่น' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('promotions')
    .update({ name, description: description || null, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/sales/promotions')
  revalidatePath('/dashboard/sales')
  return { success: true }
}

export async function setPromotionActive(id: string, isActive: boolean) {
  await requireAuthRole(['admin', 'sales'], 'Only admin/sales can manage promotions')
  const supabase = await createClient()
  const { error } = await supabase
    .from('promotions')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/sales/promotions')
  revalidatePath('/dashboard/sales')
  return { success: true }
}

function readItemForm(formData: FormData) {
  const name = String(formData.get('name') || '').trim()
  const value = Number(formData.get('value') || 0)
  return { name, value }
}

export async function addPromotionItem(promotionId: string, formData: FormData) {
  await requireAuthRole(['admin', 'sales'], 'Only admin/sales can manage promotions')
  const { name, value } = readItemForm(formData)
  if (!name) return { success: false, error: 'กรุณาใส่ชื่อรายการ' }
  if (!Number.isFinite(value) || value < 0) return { success: false, error: 'มูลค่าไม่ถูกต้อง' }

  const supabase = await createClient()
  const { error } = await supabase.from('promotion_items').insert({ promotion_id: promotionId, name, value })
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/sales/promotions')
  return { success: true }
}

export async function updatePromotionItem(id: string, formData: FormData) {
  await requireAuthRole(['admin', 'sales'], 'Only admin/sales can manage promotions')
  const { name, value } = readItemForm(formData)
  if (!name) return { success: false, error: 'กรุณาใส่ชื่อรายการ' }
  if (!Number.isFinite(value) || value < 0) return { success: false, error: 'มูลค่าไม่ถูกต้อง' }

  const supabase = await createClient()
  const { error } = await supabase.from('promotion_items').update({ name, value }).eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/sales/promotions')
  return { success: true }
}

export async function deletePromotionItem(id: string) {
  await requireAuthRole(['admin', 'sales'], 'Only admin/sales can manage promotions')
  const supabase = await createClient()
  const { error } = await supabase.from('promotion_items').delete().eq('id', id)
  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/sales/promotions')
  return { success: true }
}
