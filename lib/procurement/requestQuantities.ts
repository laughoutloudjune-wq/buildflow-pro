import type { PurchaseRequestItem } from '@/lib/types/procurement'

/**
 * What the requester originally asked for on a line.
 *
 * `purchase_request_items.quantity_requested` doesn't hold this: since the
 * partial-fulfilment migration it tracks what's still OUTSTANDING, so
 * po_create/po_update subtract whatever made it onto a PO and a manual
 * settlement subtracts the rest. A fully-ordered request therefore stores 0 on
 * every line, which is the right answer for "what's left to buy" and the wrong
 * one for a printed ใบขอซื้อ, which is a record of the ask.
 *
 * The original is reconstructed rather than stored, by adding back everything
 * that was taken off the line:
 *   outstanding + ordered on POs + manually settled
 *
 * Every path that moves quantity keeps this sum stable - po_delete removes its
 * PO lines and refunds the same quantity, undoing a settlement deletes the
 * settlement row and refunds it, and po_cancel refunds nothing but also keeps
 * its PO lines. So the sum only changes when the request itself is edited,
 * which pr_update only allows before review.
 */
export function originalQuantityRequested(item: PurchaseRequestItem): number {
  const settled = (item.purchase_request_item_settlements || []).reduce(
    (sum, settlement) => sum + Number(settlement.quantity || 0),
    0
  )
  return Number(item.quantity_requested || 0) + orderedQuantity(item) + settled
}

/**
 * How much of this line actually made it onto purchase orders raised from the
 * request. Deliberately only counts PO lines, so the number always ties back
 * to the POs listed on the request: material bought outside that flow is
 * recorded as a manual settlement instead, and shows separately with its own
 * reason and reference.
 */
export function orderedQuantity(item: PurchaseRequestItem): number {
  return (item.purchase_order_items || []).reduce((sum, line) => sum + Number(line.quantity_ordered || 0), 0)
}
