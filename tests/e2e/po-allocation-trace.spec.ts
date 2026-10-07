import { expect, test } from '@playwright/test'
import {
  allocationsToOrderLines,
  buildFulfillmentLinks,
  isFullyAllocated,
  lineContributionToPlot,
  plotWeight,
  prorate,
  receivedShare,
  summarizePlotMaterials,
  unallocatedQty,
  type AllocatedLine,
  type PlotSummaryLine,
  type PurchaseOrderStatusLike,
  type RawRequestAllocation,
} from '@/lib/procurement/allocationTrace'
import { exceedsOrdered, outstandingOnPoLine } from '@/lib/procurement/payoutReview'

// Pure-logic coverage for allocation math, PR traceability, BOQ attribution
// and lifecycle proration - no page/browser needed, so this runs
// unconditionally. The SQL side applies the same rules; its lifecycle test is
// supabase/tests/po_allocation_lifecycle.sql.

const PLOT_A = 'plot-a'
const PLOT_B = 'plot-b'
const PLOT_C = 'plot-c'

/** The acceptance case: one PO line of 55 bags, 20 for PR-101 / Plot A and 35
 * for PR-108 / Plot B, on a PO whose header lists both plots. */
function cementLine(overrides: Partial<AllocatedLine> = {}): AllocatedLine {
  return {
    poItemId: 'poi-1',
    poId: 'po-1',
    poNo: 'PO-0001',
    materialTypeId: 7,
    quantityOrdered: 55,
    quantityReceived: 0,
    unitPrice: 100,
    allocations: [
      { allocationId: 'al-101', quantity: 20, purchaseRequestId: 'pr-101', prNo: 101, scope: { plotId: PLOT_A, plotGroupId: null, memberPlotIds: [] } },
      { allocationId: 'al-108', quantity: 35, purchaseRequestId: 'pr-108', prNo: 108, scope: { plotId: PLOT_B, plotGroupId: null, memberPlotIds: [] } },
    ],
    ...overrides,
  }
}

test.describe('allocation math', () => {
  test('prorate always adds back to the total, last slice absorbs rounding', () => {
    const parts = prorate(100, [1, 1, 1])
    expect(parts.reduce((s, p) => s + p, 0)).toBeCloseTo(100, 4)
    expect(parts).toEqual([33.3333, 33.3333, 33.3334])
    expect(prorate(30, [20, 35]).reduce((s, p) => s + p, 0)).toBeCloseTo(30, 4)
  })

  test('prorate never loses the total when weights are all zero', () => {
    expect(prorate(10, [0, 0])).toEqual([0, 10])
    expect(prorate(10, [])).toEqual([])
  })

  test('a line is fully allocated only when slices sum to its quantity', () => {
    expect(isFullyAllocated(55, [20, 35])).toBe(true)
    expect(isFullyAllocated(55, [20, 30])).toBe(false)
    expect(unallocatedQty(55, [20, 30])).toBe(5)
    expect(unallocatedQty(55, [20, 40])).toBe(0) // never negative
    expect(unallocatedQty(55, [])).toBe(55) // standalone line: all of it
  })

  test('each allocation owns the same share of what arrived as of what was ordered', () => {
    expect(receivedShare(55, 55, 20)).toBe(20)
    expect(receivedShare(11, 55, 20)).toBeCloseTo(4, 4)
    expect(receivedShare(11, 55, 35)).toBeCloseTo(7, 4)
    expect(receivedShare(10, 0, 5)).toBe(0)
  })
})

test.describe('PR traceability', () => {
  function alloc(po: string, status: PurchaseOrderStatusLike, over: Partial<{ qty: number; ordered: number; received: number; material: number; name: string }> = {}): RawRequestAllocation {
    return {
      id: `al-${po}`,
      quantity_allocated: over.qty ?? 20,
      purchase_order_items: {
        id: `poi-${po}`,
        unit: null,
        quantity_ordered: over.ordered ?? 55,
        quantity_received: over.received ?? 0,
        closes_request_line: false,
        material_type_id: over.material ?? 7,
        material_types: { name: over.name ?? 'ปูนตราช้าง', unit: 'ถุง' },
        purchase_orders: { id: po, po_no: po, status, suppliers: { name: 'ร้านวัสดุ A' } },
      },
    }
  }
  const item = {
    material_type_id: 7,
    original_material_type_id: null,
    original_material: null,
    unit: null,
    material_types: { name: 'ปูนตราช้าง', unit: 'ถุง' },
  }

  test('shows this line\'s slice, not the whole PO line', () => {
    const { links, allocated, outstanding } = buildFulfillmentLinks(item, [alloc('PO-1', 'sent')])
    expect(links).toHaveLength(1)
    expect(links[0].allocated).toBe(20)
    expect(links[0].lineOrdered).toBe(55)
    expect(links[0].supplierName).toBe('ร้านวัสดุ A')
    expect(allocated).toBe(20)
    expect(outstanding).toBe(20)
  })

  test('a line fulfilled across several POs lists every link and totals them', () => {
    const { links, allocated, received, outstanding } = buildFulfillmentLinks(item, [
      alloc('PO-1', 'partially_received', { qty: 20, ordered: 55, received: 11 }),
      alloc('PO-2', 'sent', { qty: 10, ordered: 10 }),
    ])
    expect(links.map((l) => l.poNo)).toEqual(['PO-1', 'PO-2'])
    expect(links[0].received).toBeCloseTo(4, 4)
    expect(links[0].outstanding).toBeCloseTo(16, 4)
    expect(allocated).toBe(30)
    expect(received).toBeCloseTo(4, 4)
    expect(outstanding).toBeCloseTo(26, 4)
  })

  test('cancelled POs stay listed for history but are not counted', () => {
    const { links, allocated, outstanding } = buildFulfillmentLinks(item, [alloc('PO-1', 'cancelled'), alloc('PO-2', 'sent', { qty: 5, ordered: 5 })])
    expect(links).toHaveLength(2)
    expect(links[0].cancelled).toBe(true)
    expect(links[0].outstanding).toBe(0)
    expect(allocated).toBe(5)
    expect(outstanding).toBe(5)
  })

  test('a closed-short or received PO has nothing outstanding', () => {
    const { links } = buildFulfillmentLinks(item, [alloc('PO-1', 'received', { qty: 11, ordered: 11, received: 11 })])
    expect(links[0].outstanding).toBe(0)
  })

  test('the actual PO material is shown and the original request kept as history', () => {
    // The request line now shows the purchased material; the original ask is
    // the history column.
    const substituted = {
      material_type_id: 9,
      original_material_type_id: 7,
      original_material: { name: 'ปูนตราช้าง' },
      unit: null,
      material_types: { name: 'ปูนเสือ', unit: 'ถุง' },
    }
    const { links } = buildFulfillmentLinks(substituted, [alloc('PO-1', 'sent', { material: 9, name: 'ปูนเสือ' })])
    expect(links[0].actualMaterialName).toBe('ปูนเสือ')
    expect(links[0].requestedMaterialName).toBe('ปูนตราช้าง')
    expect(links[0].isSubstitute).toBe(true)
  })

  test('no substitution flag when purchasing ordered what was asked', () => {
    const { links } = buildFulfillmentLinks(item, [alloc('PO-1', 'sent')])
    expect(links[0].isSubstitute).toBe(false)
  })

  test('request quantity helpers read the allocated slice and skip cancelled orders', () => {
    const lines = allocationsToOrderLines([alloc('PO-1', 'sent', { qty: 20 }), alloc('PO-2', 'cancelled', { qty: 99 })])
    expect(lines).toHaveLength(1)
    expect(lines[0].quantity_ordered).toBe(20)
    expect(lines[0].purchase_orders?.po_no).toBe('PO-1')
  })
})

test.describe('BOQ attribution by plot', () => {
  test('55 bags: Plot A gets exactly 20, Plot B exactly 35, Plot C nothing', () => {
    const line = cementLine()
    const a = lineContributionToPlot(line, PLOT_A)
    const b = lineContributionToPlot(line, PLOT_B)
    expect(a).toHaveLength(1)
    expect(a[0].orderedQty).toBe(20)
    expect(a[0].orderedValue).toBe(2000)
    expect(a[0].prNo).toBe(101)
    expect(b[0].orderedQty).toBe(35)
    expect(b[0].orderedValue).toBe(3500)
    expect(b[0].prNo).toBe(108)
    expect(lineContributionToPlot(line, PLOT_C)).toEqual([])
  })

  test('plot attributions add back to the PO line - nothing duplicated or lost', () => {
    const line = cementLine()
    const total = [PLOT_A, PLOT_B, PLOT_C].flatMap((p) => lineContributionToPlot(line, p)).reduce((s, c) => s + c.orderedQty, 0)
    expect(total).toBe(55)
  })

  test('received quantity follows the allocation share', () => {
    const line = cementLine({ quantityReceived: 11 })
    expect(lineContributionToPlot(line, PLOT_A)[0].receivedQty).toBeCloseTo(4, 4)
    expect(lineContributionToPlot(line, PLOT_B)[0].receivedQty).toBeCloseTo(7, 4)
  })

  test('a request covering several plots splits its slice evenly', () => {
    const line = cementLine({
      allocations: [
        { allocationId: 'al-1', quantity: 40, purchaseRequestId: 'pr-1', prNo: 1, scope: { plotId: null, plotGroupId: 'g', memberPlotIds: [PLOT_A, PLOT_B] } },
        { allocationId: 'al-2', quantity: 15, purchaseRequestId: 'pr-2', prNo: 2, scope: { plotId: PLOT_B, plotGroupId: null, memberPlotIds: [] } },
      ],
    })
    expect(plotWeight(line.allocations[0].scope, PLOT_A)).toBe(0.5)
    expect(lineContributionToPlot(line, PLOT_A)[0].orderedQty).toBe(20)
    const b = lineContributionToPlot(line, PLOT_B)
    expect(b.map((c) => c.orderedQty)).toEqual([20, 15])
    expect(b[0].weight).toBe(0.5)
  })

  test('a request with no plots is unassigned, never spread around', () => {
    expect(plotWeight({ plotId: null, plotGroupId: null, memberPlotIds: [] }, PLOT_A)).toBe(0)
  })

  function summaryLine(over: Partial<PlotSummaryLine> = {}): PlotSummaryLine {
    return { ...cementLine(), materialName: 'ปูนซีเมนต์', unit: 'ถุง', remainderBelongsToPlot: true, ...over }
  }

  test('plot summary counts allocated quantity once per plot and traces each source', () => {
    const rows = summarizePlotMaterials([summaryLine()], PLOT_A)
    expect(rows).toHaveLength(1)
    expect(rows[0].orderedQty).toBe(20)
    expect(rows[0].orderedValue).toBe(2000)
    expect(rows[0].sources).toHaveLength(1)
    expect(rows[0].sources[0]).toMatchObject({ poNo: 'PO-0001', poItemId: 'poi-1', prNo: 101, allocatedQty: 20, orderedQty: 20 })
  })

  test('a line allocated only to other plots contributes nothing here, even if the header lists this plot', () => {
    expect(summarizePlotMaterials([summaryLine()], PLOT_C)).toEqual([])
  })

  test('an unallocated line keeps the order-level rule; a partial allocation only adds its remainder', () => {
    const standalone = summaryLine({ allocations: [], quantityOrdered: 10 })
    expect(summarizePlotMaterials([standalone], PLOT_C)[0].orderedQty).toBe(10)
    expect(summarizePlotMaterials([{ ...standalone, remainderBelongsToPlot: false }], PLOT_C)).toEqual([])

    const partial = summaryLine({ quantityOrdered: 60 }) // 55 allocated, 5 not
    const c = summarizePlotMaterials([{ ...partial, remainderBelongsToPlot: true }], PLOT_C)
    expect(c[0].orderedQty).toBe(5)
    expect(c[0].sources[0].prNo).toBeNull()
    // Plot A still only sees its own 20 of the 60.
    expect(summarizePlotMaterials([partial], PLOT_A)[0].orderedQty).toBe(25)
  })
})

test.describe('lifecycle', () => {
  test('close-short shrinks only this line\'s allocations, in proportion, totalling what arrived', () => {
    // 55 ordered, 11 received, then closed short: 20/35 -> 4/7 (what po_close_short does).
    const shrunk = prorate(11, [20, 35])
    expect(shrunk[0]).toBeCloseTo(4, 4)
    expect(shrunk.reduce((s, p) => s + p, 0)).toBeCloseTo(11, 4)
    // The give-back to each request line is the difference.
    expect(20 - shrunk[0] + (35 - shrunk[1])).toBeCloseTo(44, 4)
  })

  test('BOQ after close-short reflects the shrunken allocations', () => {
    const shrunk = prorate(11, [20, 35])
    const line = cementLine({
      quantityOrdered: 11,
      quantityReceived: 11,
      allocations: [
        { allocationId: 'al-101', quantity: shrunk[0], purchaseRequestId: 'pr-101', prNo: 101, scope: { plotId: PLOT_A, plotGroupId: null, memberPlotIds: [] } },
        { allocationId: 'al-108', quantity: shrunk[1], purchaseRequestId: 'pr-108', prNo: 108, scope: { plotId: PLOT_B, plotGroupId: null, memberPlotIds: [] } },
      ],
    })
    expect(lineContributionToPlot(line, PLOT_A)[0].orderedQty).toBeCloseTo(4, 4)
    expect(lineContributionToPlot(line, PLOT_B)[0].orderedQty).toBeCloseTo(7, 4)
    expect(lineContributionToPlot(line, PLOT_A)[0].receivedQty).toBeCloseTo(4, 4)
  })

  test('editing one line\'s allocations leaves an unrelated PR untouched', () => {
    const edited = cementLine({
      quantityOrdered: 50,
      allocations: [
        { allocationId: 'al-101', quantity: 15, purchaseRequestId: 'pr-101', prNo: 101, scope: { plotId: PLOT_A, plotGroupId: null, memberPlotIds: [] } },
        { allocationId: 'al-108', quantity: 35, purchaseRequestId: 'pr-108', prNo: 108, scope: { plotId: PLOT_B, plotGroupId: null, memberPlotIds: [] } },
      ],
    })
    expect(lineContributionToPlot(edited, PLOT_A)[0].orderedQty).toBe(15)
    expect(lineContributionToPlot(edited, PLOT_B)[0].orderedQty).toBe(35)
  })
})

test.describe('payout review helpers', () => {
  test('outstanding on the PO line and over-receipt flag', () => {
    expect(outstandingOnPoLine({ orderedQty: 55, totalReceivedQty: 20 })).toBe(35)
    expect(outstandingOnPoLine({ orderedQty: 55, totalReceivedQty: 60 })).toBe(0)
    expect(exceedsOrdered({ orderedQty: 55, totalReceivedQty: 60 })).toBe(true)
    expect(exceedsOrdered({ orderedQty: 55, totalReceivedQty: 55 })).toBe(false)
  })
})
