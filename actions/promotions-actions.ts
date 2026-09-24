'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'

export type Promotion = {
  id: string
  name: string
  description: string | null
  discountType: 'percent' | 'amount'
  discountValue: number
  isActive: boolean
}

type PromotionRow = {
  id: string
  name: string
  description: string | null
  discount_type: string
  discount_value: number
  is_active: boolean
}

function toPromotion(row: PromotionRow): Promotion {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    discountType: row.discount_type === 'percent' ? 'percent' : 'amount',
    discountValue: row.discount_value,
    isActive: row.is_active,
  }
}

/** Active promotions only, for the plot-detail picker - matches
 * getSaleStatuses' shape/gating so getPlotDetailBundle can call it the same
 * way (`.catch(() => [])`, since a foreman viewer of the shared plot page
 * has no 'sales' module access and should just see an empty list, not an
 * error). */
export async function getPromotions(): Promise<Promotion[]> {
  await requireModuleAccess('sales')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('promotions')
    .select('id, name, description, discount_type, discount_value, is_active')
    .eq('is_active', true)
    .order('name')
  if (error) throw new Error(error.message)
  return (data || []).map(toPromotion)
}

/** Catalogue management read (admin + sales, June's explicit choice - not
 * admin-only like sale_statuses) - includes inactive rows so they can be
 * reactivated. */
export async function getAllPromotions(): Promise<Promotion[]> {
  await requireAuthRole(['admin', 'sales'], 'Only admin/sales can manage promotions')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('promotions')
    .select('id, name, description, discount_type, discount_value, is_active')
    .order('name')
  if (error) throw new Error(error.message)
  return (data || []).map(toPromotion)
}

function readPromotionForm(formData: FormData) {
  const name = String(formData.get('name') || '').trim()
  const description = String(formData.get('description') || '').trim()
  const discountType = String(formData.get('discount_type') || 'amount') === 'percent' ? 'percent' : 'amount'
  const discountValue = Number(formData.get('discount_value') || 0)
  return { name, description, discountType, discountValue }
}

export async function createPromotion(formData: FormData) {
  const { userId } = await requireAuthRole(['admin', 'sales'], 'Only admin/sales can manage promotions')
  const { name, description, discountType, discountValue } = readPromotionForm(formData)

  if (!name) return { success: false, error: 'กรุณาใส่ชื่อโปรโมชั่น' }
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    return { success: false, error: 'มูลค่าส่วนลดไม่ถูกต้อง' }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('promotions').insert({
    name,
    description: description || null,
    discount_type: discountType,
    discount_value: discountValue,
    created_by: userId,
  })

  if (error) return { success: false, error: error.message }

  revalidatePath('/dashboard/sales/promotions')
  return { success: true }
}

export async function updatePromotion(id: string, formData: FormData) {
  await requireAuthRole(['admin', 'sales'], 'Only admin/sales can manage promotions')
  const { name, description, discountType, discountValue } = readPromotionForm(formData)

  if (!name) return { success: false, error: 'กรุณาใส่ชื่อโปรโมชั่น' }
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    return { success: false, error: 'มูลค่าส่วนลดไม่ถูกต้อง' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('promotions')
    .update({
      name,
      description: description || null,
      discount_type: discountType,
      discount_value: discountValue,
      updated_at: new Date().toISOString(),
    })
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
