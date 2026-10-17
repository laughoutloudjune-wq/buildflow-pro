import type { PurchaseRequestItem } from '@/lib/types/procurement'

type PoLine = NonNullable<PurchaseRequestItem['purchase_order_items']>[number]

/**
 * The unit a request line is actually counted in - its own override, or the
 * material's catalog unit when it never set one.
 */
export function requestLineUnit(item: PurchaseRequestItem): string {
  return item.unit || item.material_types?.unit || ''
}

/** Same question for one of the order lines raised against it. */
export function orderLineUnit(item: PurchaseRequestItem, line: PoLine): string {
  return line.unit || item.material_types?.unit || ''
}

/**
 * Whether an order line and the request line it answers are counted the same
 * way. Nothing in here ever adds or subtracts across two units that differ -
 * a box count and a piece count are not the same kind of number, and treating
 * them as one is the bug this whole area exists to fix (see
 * 202609170003_po_closes_request_line.sql).
 */
export function isSameUnit(item: PurchaseRequestItem, line: PoLine): boolean {
  return orderLineUnit(item, line) === requestLineUnit(item)
}

/**
 * What the requester asked for on a line. Since the request-lines-by-state
 * migration this is simply quantity_requested: a PO no longer counts it down.
 */
export function originalQuantityRequested(item: PurchaseRequestItem): number {
  return Number(item.quantity_requested || 0)
}

/** Still waiting to be bought: purchasing has neither linked a covering order
 * nor closed it by hand. */
export function isOpenLine(item: PurchaseRequestItem): boolean {
  return item.line_status === 'open'
}

/**
 * How much of this line made it onto purchase orders *in the line's own
 * unit* - the only order lines whose quantity can be added to it. Deliberately
 * only counts PO lines, so the number always ties back to the POs listed on
 * the request: material bought outside that flow is recorded as a manual
 * settlement instead, with its own reason and reference.
 */
export function orderedQuantity(item: PurchaseRequestItem): number {
  return (item.purchase_order_items || [])
    .filter((line) => isSameUnit(item, line))
    .reduce((sum, line) => sum + Number(line.quantity_ordered || 0), 0)
}

/**
 * What was bought against this line in some unit other than the one it was
 * asked in - shown as its own labelled fact ("19 แพ๊ค") rather than folded
 * into a number it can't legitimately join.
 */
export function purchasesInOtherUnits(item: PurchaseRequestItem): { quantity: number; unit: string; poNo: string | null }[] {
  const grouped = new Map<string, { quantity: number; unit: string; poNo: string | null }>()
  for (const line of item.purchase_order_items || []) {
    if (isSameUnit(item, line)) continue
    const unit = orderLineUnit(item, line)
    const existing = grouped.get(unit)
    if (existing) {
      existing.quantity += Number(line.quantity_ordered || 0)
      // Several POs in the same unit: the reference stops naming just one.
      if (existing.poNo !== (line.purchase_orders?.po_no || null)) existing.poNo = null
    } else {
      grouped.set(unit, {
        quantity: Number(line.quantity_ordered || 0),
        unit,
        poNo: line.purchase_orders?.po_no || null,
      })
    }
  }
  return Array.from(grouped.values())
}

/**
 * Purchasing's answer on this line: they ticked "this order covers it" on an
 * order raised against it. Mirrors `_pr_recompute_status`'s half of the same
 * rule server-side - keep the two in step.
 */
export function isAnsweredByOrder(item: PurchaseRequestItem): boolean {
  return (item.purchase_order_items || []).some((line) => line.closes_request_line)
}
