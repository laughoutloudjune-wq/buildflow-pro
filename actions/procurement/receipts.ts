'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'
import type { GoodsReceipt } from '@/lib/types/procurement'

// Same reasoning as PO_ERROR_TRANSLATIONS in actions/procurement/orders.ts.
const RECEIPT_ERROR_TRANSLATIONS: [string, string][] = [
  ['Not authenticated', 'กรุณาเข้าสู่ระบบใหม่อีกครั้ง'],
  ['Only PM/Admin can record a goods receipt', 'เฉพาะ PM/Admin เท่านั้นที่สามารถบันทึกการรับของได้'],
  ['Purchase order not found', 'ไม่พบใบสั่งซื้อนี้'],
  ['Can only receive against a purchase order that is sent or partially received', 'รับของได้เฉพาะใบสั่งซื้อที่อยู่ในสถานะส่งแล้วหรือรับของบางส่วนเท่านั้น'],
  ['One or more receipt lines do not belong to this purchase order', 'มีรายการที่ไม่ได้อยู่ในใบสั่งซื้อนี้'],
]

function translateReceiptError(message: string): string {
  return RECEIPT_ERROR_TRANSLATIONS.find(([needle]) => message.includes(needle))?.[1] || message
}

const SELECT_WITH_RELATIONS = `
  *,
  purchase_orders (po_no, supplier_id, company_id, suppliers (name), companies (name)),
  goods_receipt_items (*, purchase_order_items (material_types (name, unit))),
  payment_voucher_receipts (payment_voucher_id, amount, payment_vouchers (pp_no)),
  receiver:profiles!goods_receipts_received_by_fkey (full_name)
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

/** One receipt by id - for the printable RI and the detail modal, neither of
 * which already has the full row the way the list page does. */
export async function getGoodsReceiptById(id: string): Promise<GoodsReceipt | null> {
  await requireModuleAccess('procurement')
  const supabase = await createClient()
  const { data, error } = await supabase.from('goods_receipts').select(SELECT_WITH_RELATIONS).eq('id', id).maybeSingle()

  if (error) throw new Error(error.message)
  return (data as unknown as GoodsReceipt) || null
}

export async function createGoodsReceipt(input: {
  purchase_order_id: string
  delivery_note_no?: string
  note?: string
  /** When the delivery actually happened, if backdating a receipt entered
   * late - defaults to now() server-side when omitted. */
  received_at?: string
  /** Where this delivery unloaded unless a line says otherwise - 'store'
   * (today's behaviour) when omitted. See MATERIAL_FLOW_PLAN.md Phase 1. */
  default_destination?: 'store' | 'site'
  items: {
    purchase_order_item_id: string
    quantity_received: number
    unit_price_at_receipt?: number
    /** Overrides default_destination for this one line. Omit/null to inherit it. */
    destination?: 'store' | 'site' | null
  }[]
}): Promise<{ id: string; ri_no: string; po_status: string } | { error: string }> {
  try {
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
        default_destination: input.default_destination || 'store',
        items: items.map((i) => ({
          purchase_order_item_id: i.purchase_order_item_id,
          quantity_received: Number(i.quantity_received),
          unit_price_at_receipt: Math.max(0, Number(i.unit_price_at_receipt) || 0),
          destination: i.destination || null,
        })),
      },
    })

    if (error) throw new Error(error.message)
    revalidatePath('/dashboard/procurement/orders')
    revalidatePath(`/dashboard/procurement/orders/${input.purchase_order_id}`)
    revalidatePath('/dashboard/procurement/requests')
    revalidatePath('/dashboard/procurement/receipts')
    return data as { id: string; ri_no: string; po_status: string }
  } catch (error) {
    return { error: translateReceiptError(error instanceof Error ? error.message : 'บันทึกการรับของไม่สำเร็จ') }
  }
}
