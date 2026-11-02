/**
 * BOQ quantity control - pure types + the status/percent math from
 * BOQ_CONTROL_PLAN.md 5.5. No I/O here on purpose: this is the one piece of
 * the feature worth unit-testing directly, and it serves three call sites
 * (the cost-control page, the PO detail check panel, and the payment
 * voucher check panel) that must never compute "is this over BOQ" two
 * different ways.
 */

export type ControlScope = {
  projectId: string
  plotGroupId?: string | null
  /** Explicit plot selection; wins over plotGroupId when non-empty. */
  plotIds?: string[]
}

export type BoqControlRow = {
  materialTypeId: number
  materialName: string
  unit: string
  plannedQty: number
  allowanceQty: number
  orderedQty: number
  receivedQty: number
  issuedQty: number
  /** Baht value of issuedQty's store withdrawals at the store's average buying
   * price. Straight-to-plot deliveries are not in here: their PO already
   * carries the plot, so orderedValue has them. */
  issuedValue: number
  orderedValue: number
  receivedValue: number
  /** Open request lines not yet on a purchase order ("รอสั่ง"), in the master unit. */
  pendingQty: number
  /** Order/request lines left out of the quantities above because their unit
   * has no known conversion to the master unit (see lib/procurement/units.ts). */
  unconvertedLines: number
  /** True when any contributing document only partially overlapped the
   * scope (a batch purchase split across plots) - the true per-house share
   * is an estimate, never presented as fact. */
  isEstimated: boolean
}

export type BoqControlStatus = 'ok' | 'watch' | 'over' | 'not_in_boq' | 'no_budget'

export type BoqControlUnassignedRow = {
  materialTypeId: number
  materialName: string
  unit: string
  orderedQty: number
  orderedValue: number
  poCount: number
}

export type BoqControlOutsideBoqRow = {
  poId: string
  poNo: string
  reason: string | null
  total: number
}

export type BoqControlDetailRow = {
  docKind: 'po' | 'pr' | 'stock_out'
  docId: string
  docNo: string | null
  docDate: string | null
  supplierName: string | null
  plotLabel: string
  quantity: number
  weight: number
  status: string
  /** For a PO row from an allocation: the PO line it comes from and the
   * request that contributed the quantity - the trace back from a plot's
   * figure. Null on rows with no such link (stock, unallocated PO scope). */
  poItemId: string | null
  purchaseRequestId: string | null
  prNo: number | null
  /** The document's own figure and unit, before conversion to the master unit
   * (`quantity` is already in the master unit). */
  rawQuantity: number
  rawUnit: string
  /** False when the unit has no known conversion: `quantity` is then 0. */
  convertible: boolean
  /** How many plots the document covers - the divisor of the even split. */
  totalPlots: number
}

/** The ceiling shown to users: BOQ + allowed waste, never the bare BOQ
 * figure (a bare ceiling flags every cut-waste material as over). */
export function ceilingQty(row: BoqControlRow): number {
  return row.plannedQty + row.allowanceQty
}

/** Committed-so-far basis for the "would this push us over budget" checks
 * at signing time (BoqCheckLine / getBoqCheckForDraft's 'ordered' basis,
 * getBoqCheckForPurchaseOrder, the PR draft check): the larger of what was
 * ordered and what was issued. Never their sum - almost every issue (and
 * every straight-to-plot delivery, which posts its own 'out' movement) is
 * material that an order already counted, so adding them showed one batch
 * of 1,890 bricks as 3,780. The larger figure also stays right when stock
 * was withdrawn that this scope never ordered (issued > ordered). Deliberately
 * not receivedQty - the commitment happens at order time, not delivery.
 * This one rule also drives the cost-control rollup's percent / status /
 * excess, so every screen answers "is this over BOQ" the same way. */
export function totalUsedQty(row: BoqControlRow): number {
  return Math.max(row.orderedQty, row.issuedQty)
}

/** What this scope has actually consumed: every 'out' stock movement against
 * it, whatever posted it - a manual withdrawal from the store, or direct_to_site
 * posting for material that never entered the store at all. Shown as "ถึงแปลง".
 * It is one input of totalUsedQty above, which is what percentUsed / rowStatus /
 * excessValue compare with the ceiling: ordering counts too, so an over-order
 * is flagged before the material ships (the same max rule the PO, request and
 * receipt checks use). Never add the two - an order and its delivery are the
 * same material. */
export function consumedQty(row: BoqControlRow): number {
  return row.issuedQty
}

/** Null when there is no budget to measure against - a material bought but
 * never planned has no meaningful percentage, not a 0% or Infinity. */
export function percentUsed(row: BoqControlRow): number | null {
  const ceiling = ceilingQty(row)
  if (ceiling <= 0) return null
  return (totalUsedQty(row) / ceiling) * 100
}

/**
 * The money behind an over-BOQ row: (consumed - ceiling) x the row's own
 * average unit price. Priced off orderedValue / orderedQty because
 * stock_movements carries no price of its own (a material can be bought at
 * different prices across POs, so there's no single figure to pull from
 * there either) - orderedQty is only the price source here, not part of
 * "how much is over" any more. 0 for a row that isn't over, or that has no
 * ordered value to derive a price from (e.g. consumption with no PO history
 * at all, such as an opening-balance-only material).
 */
export function excessValue(row: BoqControlRow): number {
  const excessQty = totalUsedQty(row) - ceilingQty(row)
  if (excessQty <= 0 || row.orderedQty <= 0) return 0
  const unitPrice = row.orderedValue / row.orderedQty
  return excessQty * unitPrice
}

export function rowStatus(row: BoqControlRow): BoqControlStatus {
  const used = totalUsedQty(row)
  if (row.plannedQty === 0 && used > 0) return 'not_in_boq'
  const percent = percentUsed(row)
  if (percent === null) return 'no_budget'
  if (percent > 100) return 'over'
  if (percent >= 90) return 'watch'
  return 'ok'
}

export const STATUS_LABEL_TH: Record<BoqControlStatus, string> = {
  ok: 'ปกติ',
  watch: 'ใกล้เต็ม',
  over: 'เกิน BOQ',
  not_in_boq: 'ไม่มีใน BOQ',
  no_budget: 'ไม่มีงบ',
}

// ---------------------------------------------------------------------------
// BoqCheckPanel line shape (BOQ_CONTROL_PLAN.md 9.1) - the owner's check at
// signing time, shared by the PO detail page, PR preview, goods-receipt
// modal, payment-voucher modal, and the printed PO. Lives here (not in the
// 'use client' BoqCheckPanel component) so every one of those - including
// server-only code like the PDF builder - can share one definition of "is
// this line actually over" instead of each re-deriving it.
// ---------------------------------------------------------------------------

export type BoqCheckLine = {
  materialTypeId: number
  materialName: string
  unit: string
  /** BOQ + allowance for this document's own plot scope - the ceiling, not
   * the bare BOQ figure. */
  plannedQty: number
  /** Already committed before this document, in the same scope. */
  alreadyQty: number
  /** This PO's / this payment's / this receipt's own share. */
  thisDocQty: number
  /** alreadyQty + thisDocQty. */
  totalAfter: number
  /** Baht value of thisDocQty, where the caller has a real price to show
   * one (e.g. the payment-voucher/receipt check, priced at
   * unit_price_at_receipt). Omitted where there's no meaningful single
   * price for the line (a live PO draft with mixed/unset unit prices). */
  thisDocValue?: number
  /** Which project/plot this line was actually checked against - set only
   * when the document has more than one distinct scope (a line overridden
   * to a different project/plot than the document's own). Omitted for the
   * common single-scope case so every existing check keeps looking exactly
   * as it does today. */
  scopeLabel?: string
  /** Some of this document's lines are in a unit with no known conversion to
   * the master unit; they are left out of thisDocQty (never added as mixed
   * units) and the line says "เทียบ BOQ ไม่ได้ จนกว่าจะรู้หน่วย". */
  unconverted?: boolean
}

export type BoqCheckOverride = {
  materialTypeId: number
  reason: string
  approvedBy: string
  approvedAt: string
}

/**
 * plannedQty === 0 means no BOQ line exists for this material at all yet
 * (the common state before Phase 0's data entry is done), not a zero
 * budget to compare against - never flag an unbudgeted material as "over"
 * here. That distinction is the cost-control page's separate 'not_in_boq'
 * status, not this panel's job.
 */
export function isBoqCheckLineOver(line: BoqCheckLine): boolean {
  return line.plannedQty > 0 && line.totalAfter > line.plannedQty
}
