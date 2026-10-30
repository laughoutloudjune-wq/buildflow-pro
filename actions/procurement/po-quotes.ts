'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'

export type PoQuote = {
  id: string
  supplier_name: string
  total_price: number
  note: string | null
  is_chosen: boolean
}

/** The optional price-comparison rows typed on a purchase order. Informational
 * only: nothing else reads them. */
export async function getPoQuotes(purchaseOrderId: string): Promise<PoQuote[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('purchase_order_quotes')
    .select('id, supplier_name, total_price, note, is_chosen')
    .eq('purchase_order_id', purchaseOrderId)
    .is('removed_at', null)
    .order('created_at', { ascending: true })
  if (error) return []
  return ((data as PoQuote[]) || []).map((q) => ({ ...q, total_price: Number(q.total_price) }))
}

export async function addPoQuote(
  purchaseOrderId: string,
  input: { supplier_name: string; total_price: number; note?: string }
): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can edit quotes')
    const name = input.supplier_name.trim()
    if (!name) return { error: 'กรุณาใส่ชื่อร้าน' }
    if (!(Number(input.total_price) >= 0)) return { error: 'ราคาไม่ถูกต้อง' }
    const supabase = await createClient()
    const { count } = await supabase
      .from('purchase_order_quotes')
      .select('id', { count: 'exact', head: true })
      .eq('purchase_order_id', purchaseOrderId)
      .is('removed_at', null)
    if ((count ?? 0) >= 5) return { error: 'เก็บเปรียบเทียบได้ไม่เกิน 5 ร้าน' }
    const { error } = await supabase.from('purchase_order_quotes').insert({
      purchase_order_id: purchaseOrderId,
      supplier_name: name,
      total_price: Number(input.total_price) || 0,
      note: input.note?.trim() || null,
    })
    if (error) return { error: error.message }
    revalidatePath(`/dashboard/procurement/orders/${purchaseOrderId}`)
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' }
  }
}

/** Marks one row as the chosen quote (or clears it when it already was). */
export async function choosePoQuote(purchaseOrderId: string, quoteId: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can edit quotes')
    const supabase = await createClient()
    const { data: current } = await supabase.from('purchase_order_quotes').select('is_chosen').eq('id', quoteId).maybeSingle()
    const clear = await supabase.from('purchase_order_quotes').update({ is_chosen: false }).eq('purchase_order_id', purchaseOrderId)
    if (clear.error) return { error: clear.error.message }
    if (!current?.is_chosen) {
      const { error } = await supabase.from('purchase_order_quotes').update({ is_chosen: true }).eq('id', quoteId)
      if (error) return { error: error.message }
    }
    revalidatePath(`/dashboard/procurement/orders/${purchaseOrderId}`)
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' }
  }
}

export async function removePoQuote(purchaseOrderId: string, quoteId: string): Promise<{ ok: true } | { error: string }> {
  try {
    await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can edit quotes')
    const supabase = await createClient()
    const { error } = await supabase
      .from('purchase_order_quotes')
      .update({ removed_at: new Date().toISOString(), is_chosen: false })
      .eq('id', quoteId)
    if (error) return { error: error.message }
    revalidatePath(`/dashboard/procurement/orders/${purchaseOrderId}`)
    return { ok: true }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ' }
  }
}
