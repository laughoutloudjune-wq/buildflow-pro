'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'
import type { GoodsReceipt } from '@/lib/types/procurement'

const SELECT_WITH_RELATIONS = `
  *,
  purchase_orders (po_no, supplier_id, company_id, suppliers (name), companies (name)),
  goods_receipt_items (*, purchase_order_items (material_types (name))),
  payment_voucher_receipts (payment_voucher_id, amount, payment_vouchers (pp_no))
`

/** Every goods receipt across every PO - the ใบรับสินค้า list page. */
export async function getGoodsReceipts(): Promise<GoodsReceipt[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('goods_receipts')
    .select(SELECT_WITH_RELATIONS)
    .order('received_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data as unknown as GoodsReceipt[]) || []
}

export async function getGoodsReceiptsForOrder(purchaseOrderId: string): Promise<GoodsReceipt[]> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('goods_receipts')
    .select(SELECT_WITH_RELATIONS)
    .eq('purchase_order_id', purchaseOrderId)
    .order('received_at', { ascending: false })

  if (error) throw new Error(error.message)
  return (data as unknown as GoodsReceipt[]) || []
}

export async function createGoodsReceipt(input: {
  purchase_order_id: string
  delivery_note_no?: string
  note?: string
  /** When the delivery actually happened, if backdating a receipt entered
   * late - defaults to now() server-side when omitted. */
  received_at?: string
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
      received_at: input.received_at || null,
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
  revalidatePath('/dashboard/procurement/receipts')
  return data as { id: string; ri_no: string; po_status: string }
}
