'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'
import type { GoodsReceipt } from '@/lib/types/procurement'

export async function getGoodsReceiptsForOrder(purchaseOrderId: string): Promise<GoodsReceipt[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('goods_receipts')
    .select('*, goods_receipt_items (*)')
    .eq('purchase_order_id', purchaseOrderId)
    .order('received_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data as unknown as GoodsReceipt[]) || []
}

export async function createGoodsReceipt(input: {
  purchase_order_id: string
  delivery_note_no?: string
  note?: string
  items: { purchase_order_item_id: string; quantity_received: number; unit_price_at_receipt?: number }[]
}) {
  await requireAuthRole(['admin', 'pm'], 'Only PM/Admin can record a goods receipt')
  const supabase = await createClient()

  if (!input.purchase_order_id) throw new Error('Purchase order is required')
  const items = input.items.filter((i) => i.purchase_order_item_id && Number(i.quantity_received) > 0)
  if (items.length === 0) throw new Error('Enter a received quantity for at least one line')

  const { data, error } = await supabase.rpc('goods_receipt_create', {
    p_payload: {
      purchase_order_id: input.purchase_order_id,
      delivery_note_no: input.delivery_note_no?.trim() || null,
      note: input.note?.trim() || null,
      items: items.map((i) => ({
        purchase_order_item_id: i.purchase_order_item_id,
        quantity_received: Number(i.quantity_received),
        unit_price_at_receipt: Math.max(0, Number(i.unit_price_at_receipt) || 0),
      })),
    },
  })

  if (error) throw new Error(error.message)
  revalidatePath('/dashboard/procurement/orders')
  revalidatePath(`/dashboard/procurement/orders/${input.purchase_order_id}`)
  revalidatePath('/dashboard/procurement/requests')
  return data as { id: string; po_status: string }
}
