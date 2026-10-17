'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requireAuthRole } from '@/actions/_shared/user-role'
import { translateError as translateReceiptError } from '@/lib/errors'
import type { GoodsReceipt } from '@/lib/types/procurement'

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
    /** Quantity in the material's stock unit, when the line was bought in another unit. Omit when same. */
    stock_quantity?: number | null
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
          stock_quantity: Number(i.stock_quantity) > 0 ? Number(i.stock_quantity) : null,
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

/** How this supplier's last deliveries converted into stock units, per
 * material: stock quantity per one unit received (e.g. 6 m per bundle). Used
 * only to pre-fill the receiving screen; the person receiving still confirms
 * the number. */
export async function getLastStockConversions(
  supplierId: string,
  materialTypeIds: number[]
): Promise<Record<number, { ratio: number; unit: string | null }>> {
  await requireModuleAccess('procurement')
  if (!supplierId || materialTypeIds.length === 0) return {}
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('goods_receipt_items')
    .select(
      'quantity_received, stock_quantity, created_at, purchase_order_items!inner(material_type_id, unit, purchase_orders!inner(supplier_id))'
    )
    .not('stock_quantity', 'is', null)
    .eq('purchase_order_items.purchase_orders.supplier_id', supplierId)
    .in('purchase_order_items.material_type_id', materialTypeIds)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return {}
  const result: Record<number, { ratio: number; unit: string | null }> = {}
  for (const row of (data || []) as unknown as {
    quantity_received: number
    stock_quantity: number
    purchase_order_items: { material_type_id: number; unit: string | null }
  }[]) {
    const materialId = row.purchase_order_items?.material_type_id
    if (!materialId || result[materialId]) continue
    if (!(Number(row.quantity_received) > 0) || !(Number(row.stock_quantity) > 0)) continue
    result[materialId] = {
      ratio: Number(row.stock_quantity) / Number(row.quantity_received),
      unit: row.purchase_order_items.unit,
    }
  }
  return result
}
