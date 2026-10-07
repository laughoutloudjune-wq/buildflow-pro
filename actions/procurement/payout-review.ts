'use server'

import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { requestScopeLabel } from '@/lib/procurement/allocations'
import type { PayoutReviewLine } from '@/lib/procurement/payoutReview'

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

/**
 * What PM compares a supplier's bill against when approving a payout: for
 * every line on the selected goods receipts, the PO's ACTUAL material and
 * supplier, the quantity ordered on the PO, what this receipt delivered and
 * what has arrived in total, the price, and which requests the PO line was
 * bought for (with the foreman's original material where purchasing
 * substituted). Read under the caller's own RLS.
 */
export async function getPayoutReviewLines(receiptIds: string[]): Promise<PayoutReviewLine[]> {
  await requireModuleAccess('procurement')
  if (receiptIds.length === 0) return []
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('goods_receipt_items')
    .select(
      `id, quantity_received, unit_price_at_receipt,
       goods_receipts!inner (id, ri_no, purchase_order_id, purchase_orders (id, po_no, suppliers (name))),
       purchase_order_items (
         id, unit, quantity_ordered, quantity_received, material_type_id,
         material_types (name, unit),
         purchase_order_item_allocations (
           quantity_allocated,
           purchase_request_items (
             material_type_id, original_material_type_id,
             material_types!purchase_request_items_material_type_id_fkey (name),
             purchase_requests (
               pr_no,
               plots!purchase_requests_plot_id_fkey (name),
               plot_groups (name),
               purchase_request_plots (plot_id, plots (name))
             )
           )
         )
       )`
    )
    .in('goods_receipt_id', receiptIds)
  if (error) throw new Error(error.message)

  // Original request names: a plain lookup (the history column has no foreign key).
  const originalIds = new Set<number>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data || []) as any[]) {
    const poi = one(row.purchase_order_items)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const a of (poi?.purchase_order_item_allocations || []) as any[]) {
      const id = one(a.purchase_request_items)?.original_material_type_id
      if (id != null) originalIds.add(id)
    }
  }
  const originalNames = new Map<number, string>()
  if (originalIds.size > 0) {
    const { data: mats, error: matError } = await supabase.from('material_types').select('id, name').in('id', Array.from(originalIds))
    if (matError) throw new Error(matError.message)
    for (const m of mats || []) originalNames.set(m.id as number, m.name as string)
  }

  // PostgREST types nested embeds loosely (object or array), so rows are
  // normalised through one() instead of fighting generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data || []) as any[]).map((row): PayoutReviewLine => {
    const receipt = one(row.goods_receipts)
    const po = one(receipt?.purchase_orders)
    const poi = one(row.purchase_order_items)
    const material = one(poi?.material_types)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allocations = ((poi?.purchase_order_item_allocations || []) as any[]).map((a) => {
      const pri = one(a.purchase_request_items)
      const pr = one(pri?.purchase_requests)
      const requestedId = pri?.original_material_type_id ?? pri?.material_type_id ?? null
      return {
        prNo: pr?.pr_no ?? null,
        scopeLabel: pr
          ? requestScopeLabel({
              plots: one(pr.plots),
              plot_groups: one(pr.plot_groups),
              purchase_request_plots: pr.purchase_request_plots,
            })
          : null,
        quantity: Number(a.quantity_allocated) || 0,
        requestedMaterialName: (pri?.original_material_type_id != null ? originalNames.get(pri.original_material_type_id) : undefined) ?? one(pri?.material_types)?.name ?? null,
        isSubstitute: requestedId != null && poi?.material_type_id != null && requestedId !== poi.material_type_id,
      }
    })
    return {
      receiptItemId: row.id,
      receiptId: receipt?.id ?? '',
      riNo: receipt?.ri_no ?? '',
      poId: po?.id ?? receipt?.purchase_order_id ?? '',
      poNo: po?.po_no ?? '',
      supplierName: one(po?.suppliers)?.name ?? null,
      materialName: material?.name ?? '-',
      unit: poi?.unit || material?.unit || '',
      orderedQty: Number(poi?.quantity_ordered) || 0,
      totalReceivedQty: Number(poi?.quantity_received) || 0,
      receivedThisReceipt: Number(row.quantity_received) || 0,
      unitPrice: Number(row.unit_price_at_receipt) || 0,
      allocations,
    }
  })
}
