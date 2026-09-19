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
}

export type PlotHistoryRowView = Omit<PlotSaleHistoryEntry, 'amount'> & { amount: number | null }
