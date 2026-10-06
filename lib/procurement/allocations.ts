import type { PurchaseOrderItemAllocation } from '@/lib/types/procurement'

type RequestScope = {
  plots?: { name: string } | null
  plot_groups?: { name: string } | null
  purchase_request_plots?: { plot_id: string; plots?: { name: string } | null }[]
} | null | undefined

/** "แปลง 12" / "กลุ่มแปลง A" / "แปลง 3, 4" - the plot or batch a request is
 * for, in the same wording the request itself uses. Null when it has none. */
export function requestScopeLabel(request: RequestScope): string | null {
  if (!request) return null
  if (request.plots?.name) return `แปลง ${request.plots.name}`
  if (request.plot_groups?.name) return `กลุ่มแปลง ${request.plot_groups.name}`
  const names = (request.purchase_request_plots || []).map((p) => p.plots?.name).filter(Boolean)
  return names.length > 0 ? `แปลง ${names.join(', ')}` : null
}

export type AllocationRow = {
  allocationId: string
  purchaseRequestId: string | null
  prNo: number | null
  plotLabel: string | null
  quantity: number
}

/** A PO line's allocations as display rows, ordered by request number. Empty
 * for a standalone line. */
export function allocationRows(allocations: PurchaseOrderItemAllocation[] | undefined): AllocationRow[] {
  return (allocations || [])
    .map((a) => {
      const request = a.purchase_request_items?.purchase_requests
      return {
        allocationId: a.id,
        purchaseRequestId: a.purchase_request_items?.purchase_request_id ?? null,
        prNo: request?.pr_no ?? null,
        plotLabel: requestScopeLabel(request),
        quantity: Number(a.quantity_allocated),
      }
    })
    .sort((x, y) => (x.prNo ?? 0) - (y.prNo ?? 0))
}
