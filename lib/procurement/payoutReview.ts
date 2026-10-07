/** One line of the payout comparison: the PO's actual material set against
 * what a receipt delivered (see actions/procurement/payout-review.ts). */
export type PayoutReviewLine = {
  receiptItemId: string
  receiptId: string
  riNo: string
  poId: string
  poNo: string
  supplierName: string | null
  /** The material purchasing ordered - what the supplier's bill must match. */
  materialName: string
  unit: string
  orderedQty: number
  totalReceivedQty: number
  receivedThisReceipt: number
  unitPrice: number
  allocations: {
    prNo: number | null
    scopeLabel: string | null
    quantity: number
    requestedMaterialName: string | null
    isSubstitute: boolean
  }[]
}

/** Quantity still to arrive on the PO line after everything received. */
export function outstandingOnPoLine(line: Pick<PayoutReviewLine, 'orderedQty' | 'totalReceivedQty'>): number {
  return Math.max(0, Math.round((line.orderedQty - line.totalReceivedQty) * 10000) / 10000)
}

/** Whether what has arrived exceeds what the PO line ordered - the first
 * thing to check against the supplier's bill. */
export function exceedsOrdered(line: Pick<PayoutReviewLine, 'orderedQty' | 'totalReceivedQty'>): boolean {
  return line.totalReceivedQty > line.orderedQty + 0.0001
}
