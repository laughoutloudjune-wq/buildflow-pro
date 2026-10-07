/**
 * Allocation traceability - pure math and shaping, no I/O.
 *
 * A PO line is the supplier-facing total ("Cement 55 bags"); its rows in
 * purchase_order_item_allocations say which request line - and so which plot
 * or batch - each slice of that total belongs to:
 *
 *   PO line: Cement 55 bags (actual material ordered by purchasing)
 *     PR-101 / Plot A   20
 *     PR-108 / Plot B   35
 *
 * Everything that has to answer "how much of this PO is MINE" - the request
 * modal, the payout review, a plot's BOQ view - goes through the helpers
 * below so the answer is computed one way. The SQL side (the po_* functions
 * and boq_control_* rollups) applies the same rules; keep the two in step.
 */

const EPS = 0.0001

export function round4(n: number): number {
  return Math.round((Number(n) || 0) * 10000) / 10000
}

/**
 * Split `total` across `weights` proportionally, to 4 decimals, with the last
 * slice absorbing the rounding so the parts always add back to `total`
 * exactly. Mirrors how po_close_short shrinks a line's allocations. Zero or
 * missing weights get zero; if every weight is zero the total is not lost -
 * it goes to the last slice.
 */
export function prorate(total: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []
  const sum = weights.reduce((s, w) => s + Math.max(0, Number(w) || 0), 0)
  if (sum <= 0) return weights.map((_, i) => (i === n - 1 ? round4(total) : 0))
  const out: number[] = []
  let assigned = 0
  for (let i = 0; i < n; i++) {
    if (i === n - 1) {
      out.push(round4(Math.max(0, total - assigned)))
    } else {
      const part = round4((total * Math.max(0, Number(weights[i]) || 0)) / sum)
      out.push(part)
      assigned = round4(assigned + part)
    }
  }
  return out
}

/** The part of a PO line's received quantity that belongs to one allocation:
 * receipts are recorded against the line, so each allocation owns the same
 * share of what arrived as it owns of what was ordered. */
export function receivedShare(lineReceived: number, lineOrdered: number, allocated: number): number {
  if (!(lineOrdered > 0)) return 0
  return round4((Number(lineReceived) || 0) * (Number(allocated) || 0) / lineOrdered)
}

/** What of a PO line is NOT covered by its allocations. Zero for a fully
 * allocated line; the whole line for a standalone one. Never negative. */
export function unallocatedQty(lineOrdered: number, allocated: number[]): number {
  const sum = allocated.reduce((s, q) => s + (Number(q) || 0), 0)
  return Math.max(0, round4((Number(lineOrdered) || 0) - sum))
}

/** True when the allocations of a line account for exactly its quantity. */
export function isFullyAllocated(lineOrdered: number, allocated: number[]): boolean {
  const sum = allocated.reduce((s, q) => s + (Number(q) || 0), 0)
  return Math.abs(sum - (Number(lineOrdered) || 0)) <= EPS
}

/** How much more can be allocated to a request line: what is still
 * outstanding on it, never negative. */
export function remainingToAllocate(outstanding: number, alreadyAllocatedByThisOrder = 0): number {
  return Math.max(0, round4((Number(outstanding) || 0) + (Number(alreadyAllocatedByThisOrder) || 0)))
}

// ---------------------------------------------------------------------------
// Request-line fulfilment (the PR modal)
// ---------------------------------------------------------------------------

export type PurchaseOrderStatusLike = 'draft' | 'sent' | 'partially_received' | 'received' | 'paid' | 'cancelled'

/** One allocation of a request line, as the request queries load it. */
export type RawRequestAllocation = {
  id?: string
  quantity_allocated: number | string
  purchase_order_items: {
    id?: string
    unit: string | null
    quantity_ordered: number | string
    quantity_received: number | string
    closes_request_line: boolean
    material_type_id?: number
    material_types?: { name: string; unit: string } | null
    purchase_orders: {
      id: string
      po_no: string
      status: PurchaseOrderStatusLike
      suppliers?: { name: string } | null
    } | null
  } | null
}

/** One PO that fulfils (part of) a request line. */
export type FulfillmentLink = {
  allocationId: string | null
  poId: string
  poNo: string
  poStatus: PurchaseOrderStatusLike
  supplierName: string | null
  poItemId: string | null
  /** What purchasing actually ordered - the material the supplier's bill is
   * checked against. */
  actualMaterialId: number | null
  actualMaterialName: string
  /** What the foreman asked for. Kept as history; never overwritten. */
  requestedMaterialName: string
  /** True when purchasing ordered something other than what was requested. */
  isSubstitute: boolean
  unit: string
  /** This request line's slice of the PO line. */
  allocated: number
  /** This request line's share of what has arrived. */
  received: number
  /** Still to arrive for this slice; 0 once the PO is closed or cancelled. */
  outstanding: number
  /** The whole PO line, for context ("20 of 55"). */
  lineOrdered: number
  cancelled: boolean
}

export type FulfillmentSummary = {
  links: FulfillmentLink[]
  /** Cancelled orders are listed above for history but excluded here. */
  allocated: number
  received: number
  outstanding: number
}

/** The per-PO-line shape the request quantity helpers read
 * (lib/procurement/requestQuantities.ts), rebuilt from allocations: one entry
 * per live PO line that draws on the request line, carrying the ALLOCATED
 * quantity - a consolidated PO line may serve several requests, and only this
 * request's slice belongs here - in the unit the PO line was really bought
 * in. Cancelled orders are left out: their quantity went back to the line
 * when they were cancelled. */
export function allocationsToOrderLines(allocations: RawRequestAllocation[] | undefined) {
  return (allocations || [])
    .filter((a) => a.purchase_order_items && a.purchase_order_items.purchase_orders?.status !== 'cancelled')
    .map((a) => ({
      quantity_ordered: Number(a.quantity_allocated) || 0,
      unit: a.purchase_order_items!.unit || a.purchase_order_items!.material_types?.unit || null,
      closes_request_line: a.purchase_order_items!.closes_request_line,
      purchase_orders: a.purchase_order_items!.purchase_orders
        ? {
            id: a.purchase_order_items!.purchase_orders.id,
            po_no: a.purchase_order_items!.purchase_orders.po_no,
            status: a.purchase_order_items!.purchase_orders.status,
          }
        : null,
    }))
}

type RequestItemLike = {
  material_type_id: number
  /** What the foreman first asked for - set the first time purchasing's
   * material replaced the line's own. Null while it never changed. */
  original_material_type_id?: number | null
  original_material?: { name: string } | null
  unit: string | null
  material_types?: { name: string; unit: string } | null
}

/**
 * Every PO linked to a request line, with the actual PO material and
 * supplier, this line's allocated/received/outstanding quantity, and the
 * order's status. A line fulfilled across several POs yields one link each;
 * quantities of different units are never added together (summary totals
 * only count links in the request line's own unit).
 */
export function buildFulfillmentLinks(item: RequestItemLike, allocations: RawRequestAllocation[] | undefined): FulfillmentSummary {
  // The line's own material is what was purchased once a PO replaced it; the
  // original ask is kept separately as history.
  const requestedName = item.original_material?.name || item.material_types?.name || '-'
  const requestedMaterialId = item.original_material_type_id ?? item.material_type_id
  const requestUnit = item.unit || item.material_types?.unit || ''

  const links: FulfillmentLink[] = []
  for (const a of allocations || []) {
    const poi = a.purchase_order_items
    const po = poi?.purchase_orders
    if (!poi || !po) continue
    const allocated = Number(a.quantity_allocated) || 0
    const lineOrdered = Number(poi.quantity_ordered) || 0
    const received = receivedShare(Number(poi.quantity_received) || 0, lineOrdered, allocated)
    const cancelled = po.status === 'cancelled'
    const closed = po.status === 'received' || po.status === 'paid'
    const actualName = poi.material_types?.name || requestedName
    links.push({
      allocationId: a.id ?? null,
      poId: po.id,
      poNo: po.po_no,
      poStatus: po.status,
      supplierName: po.suppliers?.name ?? null,
      poItemId: poi.id ?? null,
      actualMaterialId: poi.material_type_id ?? null,
      actualMaterialName: actualName,
      requestedMaterialName: requestedName,
      isSubstitute: poi.material_type_id != null && poi.material_type_id !== requestedMaterialId,
      unit: poi.unit || poi.material_types?.unit || requestUnit,
      allocated,
      received,
      outstanding: cancelled || closed ? 0 : Math.max(0, round4(allocated - received)),
      lineOrdered,
      cancelled,
    })
  }

  links.sort((x, y) => x.poNo.localeCompare(y.poNo, undefined, { numeric: true }))

  const counted = links.filter((l) => !l.cancelled && l.unit === requestUnit)
  return {
    links,
    allocated: round4(counted.reduce((s, l) => s + l.allocated, 0)),
    received: round4(counted.reduce((s, l) => s + l.received, 0)),
    outstanding: round4(counted.reduce((s, l) => s + l.outstanding, 0)),
  }
}

// ---------------------------------------------------------------------------
// Attribution to plots (BOQ views)
// ---------------------------------------------------------------------------

/** The plot scope of a request (or order): one of three exclusive shapes. */
export type PlotScopeShape = {
  plotId: string | null
  plotGroupId: string | null
  /** Members of plotGroupId, or the ad-hoc multi-plot selection. */
  memberPlotIds: string[]
}

/** The plots a scope covers. */
export function scopePlots(scope: PlotScopeShape): string[] {
  if (scope.plotId) return [scope.plotId]
  return scope.memberPlotIds
}

/** Share of a slice that lands on `plotId`: an even split across the scope's
 * plots, 1 for a single-plot scope, 0 when the plot is outside the scope or
 * the scope names no plots (those are "unassigned", never spread around).
 * The same rule boq_control_rollup applies in SQL. */
export function plotWeight(scope: PlotScopeShape, plotId: string): number {
  const plots = scopePlots(scope)
  if (plots.length === 0 || !plots.includes(plotId)) return 0
  return 1 / plots.length
}

export type AllocatedLine = {
  poItemId: string
  poId: string
  poNo: string
  materialTypeId: number
  quantityOrdered: number
  quantityReceived: number
  unitPrice: number
  allocations: {
    allocationId: string
    quantity: number
    purchaseRequestId: string
    prNo: number | null
    scope: PlotScopeShape
  }[]
}

export type PlotContribution = {
  poItemId: string
  poId: string
  poNo: string
  materialTypeId: number
  allocationId: string
  purchaseRequestId: string
  prNo: number | null
  /** The allocation's own quantity (before any split across plots). */
  allocatedQty: number
  /** What lands on the plot: allocatedQty x the plot's share. */
  orderedQty: number
  receivedQty: number
  orderedValue: number
  /** < 1 when the request covered several plots and this is an even split. */
  weight: number
}

/**
 * What one PO line contributes to one plot, from its recorded allocations
 * only: each allocation counts for its request's plots, nothing else. The
 * PO header's plot scope is deliberately not an input - a combined PO that
 * lists plots A and B does not put the whole line on both. Allocations to
 * other plots contribute nothing here, and the part of the line no allocation
 * covers is the caller's to handle (see unallocatedQty).
 */
export function lineContributionToPlot(line: AllocatedLine, plotId: string): PlotContribution[] {
  const out: PlotContribution[] = []
  for (const a of line.allocations) {
    const weight = plotWeight(a.scope, plotId)
    if (weight <= 0) continue
    const received = receivedShare(line.quantityReceived, line.quantityOrdered, a.quantity)
    out.push({
      poItemId: line.poItemId,
      poId: line.poId,
      poNo: line.poNo,
      materialTypeId: line.materialTypeId,
      allocationId: a.allocationId,
      purchaseRequestId: a.purchaseRequestId,
      prNo: a.prNo,
      allocatedQty: a.quantity,
      orderedQty: round4(a.quantity * weight),
      receivedQty: round4(received * weight),
      orderedValue: round4(a.quantity * weight * line.unitPrice),
      weight,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// A plot's materials, allocation-aware
// ---------------------------------------------------------------------------

export type PlotSummaryLine = AllocatedLine & {
  materialName: string
  unit: string
  /** Whether the part of the line no allocation covers belongs to this plot
   * under the order's own header / line-override scope (the pre-allocation
   * rule). Irrelevant for a fully allocated line. */
  remainderBelongsToPlot: boolean
}

/** Where a number on a plot's materials row came from. */
export type PlotMaterialSource = {
  poId: string
  poNo: string
  poItemId: string
  /** Null for the part of a line recorded against no request. */
  purchaseRequestId: string | null
  prNo: number | null
  /** The slice of the PO line (before any split across plots). */
  allocatedQty: number
  orderedQty: number
  receivedQty: number
  weight: number
}

export type PlotMaterialSummaryRow = {
  materialTypeId: number
  name: string
  unit: string
  orderedQty: number
  receivedQty: number
  orderedValue: number
  sources: PlotMaterialSource[]
}

/**
 * Roll PO lines up into one row per material for one plot. Allocated
 * quantity counts only through the allocations that name this plot; the
 * PO header's plot list is never applied to it. The part of a line no
 * allocation covers is attributed by the old header rule
 * (remainderBelongsToPlot) so nothing is lost or counted twice.
 */
export function summarizePlotMaterials(lines: PlotSummaryLine[], plotId: string): PlotMaterialSummaryRow[] {
  const rows = new Map<number, PlotMaterialSummaryRow>()
  const rowFor = (line: PlotSummaryLine) => {
    let row = rows.get(line.materialTypeId)
    if (!row) {
      row = { materialTypeId: line.materialTypeId, name: line.materialName, unit: line.unit, orderedQty: 0, receivedQty: 0, orderedValue: 0, sources: [] }
      rows.set(line.materialTypeId, row)
    }
    return row
  }

  for (const line of lines) {
    for (const c of lineContributionToPlot(line, plotId)) {
      const row = rowFor(line)
      row.orderedQty += c.orderedQty
      row.receivedQty += c.receivedQty
      row.orderedValue += c.orderedValue
      row.sources.push({
        poId: c.poId,
        poNo: c.poNo,
        poItemId: c.poItemId,
        purchaseRequestId: c.purchaseRequestId,
        prNo: c.prNo,
        allocatedQty: c.allocatedQty,
        orderedQty: c.orderedQty,
        receivedQty: c.receivedQty,
        weight: c.weight,
      })
    }

    const remainder = unallocatedQty(line.quantityOrdered, line.allocations.map((a) => a.quantity))
    if (remainder > 0 && line.remainderBelongsToPlot) {
      const row = rowFor(line)
      const received = receivedShare(line.quantityReceived, line.quantityOrdered, remainder)
      row.orderedQty += remainder
      row.receivedQty += received
      row.orderedValue += remainder * line.unitPrice
      row.sources.push({
        poId: line.poId,
        poNo: line.poNo,
        poItemId: line.poItemId,
        purchaseRequestId: null,
        prNo: null,
        allocatedQty: remainder,
        orderedQty: remainder,
        receivedQty: received,
        weight: 1,
      })
    }
  }

  return Array.from(rows.values())
    .map((r) => ({ ...r, orderedQty: round4(r.orderedQty), receivedQty: round4(r.receivedQty), orderedValue: round4(r.orderedValue) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'th'))
}
