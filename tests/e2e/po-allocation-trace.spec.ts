import { expect, test } from '@playwright/test'
import {
  allocationsToOrderLines,
  buildFulfillmentLinks,
  isFullyAllocated,
  lineContributionToPlot,
  plotWeight,
  prorate,
  receivedShare,
  resolveRequestMaterial,
  splitReceiptAcrossSlices,
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
    return { ...cementLine(), materialName: 'ปูนซีเมนต์', unit: 'ถุง', remainderWeight: 1, ...over }
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
    expect(summarizePlotMaterials([{ ...standalone, remainderWeight: 0 }], PLOT_C)).toEqual([])

    const partial = summaryLine({ quantityOrdered: 60 }) // 55 allocated, 5 not
    const c = summarizePlotMaterials([{ ...partial, remainderWeight: 1 }], PLOT_C)
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

// ---------------------------------------------------------------------------
// Audit cases (procurement / BOQ audit)
// ---------------------------------------------------------------------------

test.describe('audit: substituted material across PO lifecycle', () => {
  const requestItem = (overrides: Record<string, unknown> = {}) => ({
    material_type_id: 2, // cement B - what the PR line shows after the PO
    original_material_type_id: 1, // cement A - what was asked for
    original_material: { name: 'ปูน A' },
    unit: null,
    material_types: { name: 'ปูน B', unit: 'ถุง' },
    ...overrides,
  })
  const alloc = (po: string, status: PurchaseOrderStatusLike, material: number, name: string, qty: number, lineOrdered: number, lineReceived = 0): RawRequestAllocation => ({
    id: `al-${po}-${qty}`,
    quantity_allocated: qty,
    purchase_order_items: {
      id: `poi-${po}`,
      unit: null,
      quantity_ordered: lineOrdered,
      quantity_received: lineReceived,
      closes_request_line: false,
      material_type_id: material,
      material_types: { name, unit: 'ถุง' },
      purchase_orders: { id: po, po_no: po, status, suppliers: { name: 'ร้าน A' } },
    },
  })

  test('PR-101 and PR-102 asked for A, one PO line buys B: both show B and keep A as history', () => {
    // Each PR item shares the same PO line (cement B, 55 bags, 20 + 35).
    const pr101 = buildFulfillmentLinks(requestItem(), [alloc('PO-1', 'sent', 2, 'ปูน B', 20, 55)])
    const pr102 = buildFulfillmentLinks(requestItem(), [alloc('PO-1', 'sent', 2, 'ปูน B', 35, 55)])
    for (const summary of [pr101, pr102]) {
      expect(summary.links[0].actualMaterialName).toBe('ปูน B')
      expect(summary.links[0].requestedMaterialName).toBe('ปูน A')
      expect(summary.links[0].isSubstitute).toBe(true)
      expect(summary.mixedMaterials).toBe(false)
    }
    expect(pr101.links[0].allocated).toBe(20)
    expect(pr102.links[0].allocated).toBe(35)
  })

  test('the request line shows the one material its live orders bought, else the original', () => {
    const A = 1
    const B = 2
    const C = 3
    expect(resolveRequestMaterial(A, [])).toBe(A) // order cancelled / allocation removed -> back to the ask
    expect(resolveRequestMaterial(A, [B])).toBe(B)
    expect(resolveRequestMaterial(A, [B, B])).toBe(B) // two orders, same material
    expect(resolveRequestMaterial(A, [B, C])).toBe(A) // two orders, different materials -> explicit, not silently one of them
  })

  test('a request line served by two live POs with different materials is flagged as mixed', () => {
    const { links, mixedMaterials } = buildFulfillmentLinks(requestItem({ material_type_id: 1, original_material_type_id: 1, original_material: null, material_types: { name: 'ปูน A', unit: 'ถุง' } }), [
      alloc('PO-1', 'sent', 2, 'ปูน B', 20, 20),
      alloc('PO-2', 'sent', 3, 'ปูน C', 10, 10),
    ])
    expect(mixedMaterials).toBe(true)
    expect(links.map((l) => l.actualMaterialName)).toEqual(['ปูน B', 'ปูน C'])
  })

  test('a cancelled PO does not make a request line "mixed"; the remaining live order decides', () => {
    const { mixedMaterials, allocated, outstanding } = buildFulfillmentLinks(requestItem(), [
      alloc('PO-1', 'cancelled', 3, 'ปูน C', 20, 20),
      alloc('PO-2', 'sent', 2, 'ปูน B', 10, 10),
    ])
    expect(mixedMaterials).toBe(false)
    expect(allocated).toBe(10)
    expect(outstanding).toBe(10)
  })
})

test.describe('audit: partial receipt on a consolidated line', () => {
  const sharedLine = (received: number): RawRequestAllocation => ({
    id: 'al-1',
    quantity_allocated: 20,
    purchase_order_items: {
      id: 'poi-1',
      unit: null,
      quantity_ordered: 55,
      quantity_received: received,
      closes_request_line: false,
      material_type_id: 7,
      material_types: { name: 'ปูน', unit: 'ถุง' },
      purchase_orders: { id: 'po-1', po_no: 'PO-1', status: 'partially_received', suppliers: null },
    },
  })
  const item = { material_type_id: 7, original_material_type_id: null, original_material: null, unit: null, material_types: { name: 'ปูน', unit: 'ถุง' } }

  test('11 of 55 delivered: PR-101 shows 4 and the figure is marked as an estimate', () => {
    const [link] = buildFulfillmentLinks(item, [sharedLine(11)]).links
    expect(link.received).toBeCloseTo(4, 4)
    expect(link.receivedIsEstimate).toBe(true)
  })

  test('nothing delivered, or everything delivered, is exact - not an estimate', () => {
    expect(buildFulfillmentLinks(item, [sharedLine(0)]).links[0].receivedIsEstimate).toBe(false)
    expect(buildFulfillmentLinks(item, [sharedLine(55)]).links[0].receivedIsEstimate).toBe(false)
  })

  test('a line used by one request only is never an estimate', () => {
    const only: RawRequestAllocation = { ...sharedLine(11), quantity_allocated: 55 }
    expect(buildFulfillmentLinks(item, [only]).links[0].receivedIsEstimate).toBe(false)
  })

  test('direct-to-site delivery of 11 is charged 4 to Plot A and 7 to Plot B, exactly 11 in total', () => {
    const slices = splitReceiptAcrossSlices(
      11,
      55,
      [
        { quantity: 20, projectId: 'p1', plotId: PLOT_A, plotGroupId: null, adHocPlotIds: [] },
        { quantity: 35, projectId: 'p1', plotId: PLOT_B, plotGroupId: null, adHocPlotIds: [] },
      ],
      { projectId: 'p1', plotId: null, plotGroupId: null }
    )
    expect(slices.map((x) => [x.plotId, x.qty])).toEqual([
      [PLOT_A, 4],
      [PLOT_B, 7],
    ])
    expect(slices.reduce((t, x) => t + x.qty, 0)).toBeCloseTo(11, 4)
  })

  test('a delivery is charged to each request\'s own project, a group, or split across an ad-hoc plot list', () => {
    const slices = splitReceiptAcrossSlices(
      30,
      30,
      [
        { quantity: 10, projectId: 'p1', plotId: null, plotGroupId: 'g1', adHocPlotIds: [] },
        { quantity: 20, projectId: 'p2', plotId: null, plotGroupId: null, adHocPlotIds: [PLOT_A, PLOT_B] },
      ],
      { projectId: 'p1', plotId: null, plotGroupId: null }
    )
    expect(slices).toEqual([
      { projectId: 'p1', plotId: null, plotGroupId: 'g1', qty: 10 },
      { projectId: 'p2', plotId: PLOT_A, plotGroupId: null, qty: 10 },
      { projectId: 'p2', plotId: PLOT_B, plotGroupId: null, qty: 10 },
    ])
  })

  test('the unallocated part of a line keeps the order\'s scope; a line with no allocations is one slice as before', () => {
    const withRemainder = splitReceiptAcrossSlices(
      60,
      60,
      [{ quantity: 55, projectId: 'p1', plotId: PLOT_A, plotGroupId: null, adHocPlotIds: [] }],
      { projectId: 'p1', plotId: PLOT_C, plotGroupId: null }
    )
    expect(withRemainder.map((x) => [x.plotId, x.qty])).toEqual([
      [PLOT_A, 55],
      [PLOT_C, 5],
    ])
    expect(splitReceiptAcrossSlices(9, 9, [], { projectId: 'p1', plotId: PLOT_C, plotGroupId: null })).toEqual([
      { projectId: 'p1', plotId: PLOT_C, plotGroupId: null, qty: 9 },
    ])
  })
})

test.describe('audit: one request covering several plots', () => {
  test('the even split is the current rule: 40 bags over two plots is 20 + 20, never 30 + 10', () => {
    const line = cementLine({
      quantityOrdered: 40,
      allocations: [{ allocationId: 'al-1', quantity: 40, purchaseRequestId: 'pr-1', prNo: 1, scope: { plotId: null, plotGroupId: 'g', memberPlotIds: [PLOT_A, PLOT_B] } }],
    })
    const a = lineContributionToPlot(line, PLOT_A)[0]
    const b = lineContributionToPlot(line, PLOT_B)[0]
    expect([a.orderedQty, b.orderedQty]).toEqual([20, 20])
    // The row says it is an even share so the screen can label it an estimate.
    expect(a.weight).toBe(0.5)
    expect(summarizePlotMaterials([{ ...line, materialName: 'ปูน', unit: 'ถุง', remainderWeight: 0 }], PLOT_A)[0].sources[0].weight).toBe(0.5)
  })
})

test.describe('audit: partly allocated PO line', () => {
  test('60 bags, 20 to A and 35 to B, 5 unallocated: the 5 is counted once and totals reconcile to 60', () => {
    // The order header lists plots A, B and C, so the unallocated 5 splits 1/3 each.
    const line = (): PlotSummaryLine => ({ ...cementLine({ quantityOrdered: 60 }), materialName: 'ปูน', unit: 'ถุง', remainderWeight: 1 / 3 })
    const perPlot = [PLOT_A, PLOT_B, PLOT_C].map((p) => summarizePlotMaterials([line()], p)[0])
    expect(perPlot.reduce((t, r) => t + r.orderedQty, 0)).toBeCloseTo(60, 3)
    // Request-linked rows keep their PR; the remainder row has none.
    const sources = perPlot.flatMap((r) => r.sources)
    expect(sources.filter((x) => x.prNo == null)).toHaveLength(3)
    expect(sources.filter((x) => x.prNo != null).reduce((t, x) => t + x.orderedQty, 0)).toBe(55)
    expect(sources.filter((x) => x.prNo == null).reduce((t, x) => t + x.orderedQty, 0)).toBeCloseTo(5, 3)
    // Plot A: its own 20 plus a third of the remainder.
    expect(perPlot[0].orderedQty).toBeCloseTo(20 + 5 / 3, 3)
  })

  test('the remainder is not repeated in full on every plot of the header', () => {
    const line: PlotSummaryLine = { ...cementLine({ quantityOrdered: 10, allocations: [] }), materialName: 'ปูน', unit: 'ถุง', remainderWeight: 0.5 }
    expect(summarizePlotMaterials([line], PLOT_A)[0].orderedQty).toBe(5)
  })
})
