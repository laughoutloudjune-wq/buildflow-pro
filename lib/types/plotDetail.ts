import type { PlotMaterialSource } from '@/lib/procurement/allocationTrace'
import type { PlotStockEntry } from '@/actions/plot-stock-trail-actions'
import type { PlotSaleHistoryEntry } from '@/actions/sales-actions'

/** Job row for the plot detail page's งานก่อสร้าง tab. `cost` is null
 * whenever the viewer's canSeeCost is false - the server component strips it
 * before this ever reaches the client, so there is nothing here to hide in
 * CSS, only to conditionally render. */
export type PlotJobRow = {
  id: string
  status: string
  itemName: string
  unit: string
  quantity: number
  contractorId: string | null
  cost: {
    contractorName: string | null
    agreedPricePerUnit: number | null
    boqPricePerUnit: number
    effectivePrice: number
    totalBoq: number
    paid: number
  } | null
}

/** Material row for the วัสดุ tab. orderedValue is null under the same rule
 * as PlotJobRow.cost. */
export type PlotMaterialRowView = {
  materialTypeId: number
  name: string
  unit: string
  orderedQty: number
  receivedQty: number
  orderedValue: number | null
  /** Which PO line and request each part of the figure came from (no money). */
  sources: PlotMaterialSource[]
  /** BOQ planned quantity and waste allowance for this plot's house model;
   * null when the BOQ has no line for this material. */
  plannedQty: number | null
  allowanceQty: number | null
  /** This plot's share of store withdrawals (เบิก) and straight-to-plot deliveries. */
  issuedQty: number
  /** Baht value of issuedQty at the store's average buying price; null without cost access. */
  issuedValue: number | null
  directQty: number
  /** The withdrawal slips / deliveries behind issuedQty and directQty. */
  stockEntries: PlotStockEntry[]
}

export type PlotHistoryRowView = Omit<PlotSaleHistoryEntry, 'amount'> & { amount: number | null }
