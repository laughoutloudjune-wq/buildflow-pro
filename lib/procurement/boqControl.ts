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
  orderedValue: number
  receivedValue: number
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
}

/** The ceiling shown to users: BOQ + allowed waste, never the bare BOQ
 * figure (a bare ceiling flags every cut-waste material as over). */
export function ceilingQty(row: BoqControlRow): number {
  return row.plannedQty + row.allowanceQty
}

/** Committed-so-far basis for the "would this push us over budget" checks
 * at signing time (BoqCheckLine / getBoqCheckForDraft's 'ordered' basis,
 * getBoqCheckForPurchaseOrder, the PR draft check) - ordered (whether or not
 * it has arrived yet) plus issued from stock. Deliberately not receivedQty -
 * the commitment happens at order time, not delivery. Deliberately NOT used
 * for the cost-control rollup's own ceiling/status/percent any more - see
 * consumedQty below. */
export function totalUsedQty(row: BoqControlRow): number {
  return row.orderedQty + row.issuedQty
}

/** What this scope has actually consumed: every 'out' stock movement against
 * it, whatever posted it - a manual withdrawal from the store, or Phase 1's
 * direct_to_site posting for material that never entered the store at all.
 * This, not totalUsedQty, is what the cost-control rollup page compares
 * against the BOQ ceiling (percentUsed/rowStatus/excessValue below) - once
 * material can be bought for house 101 and then issued to house 101, adding
 * purchase and consumption together would double-count the same material
 * (MATERIAL_FLOW_PLAN.md Phase 4). orderedQty/receivedQty stay on the row as
 * their own "on order" figure, still shown, just not part of this. The
 * precommitment checks above keep using totalUsedQty on purpose: an early
 * warning has to count what's already been ordered, not just what's been
 * consumed, or an over-order would never trip it before the material ships. */
export function consumedQty(row: BoqControlRow): number {
  return row.issuedQty
}

/** Null when there is no budget to measure against - a material bought but
 * never planned has no meaningful percentage, not a 0% or Infinity. */
export function percentUsed(row: BoqControlRow): number | null {
  const ceiling = ceilingQty(row)
  if (ceiling <= 0) return null
  return (consumedQty(row) / ceiling) * 100
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
  const excessQty = consumedQty(row) - ceilingQty(row)
  if (excessQty <= 0 || row.orderedQty <= 0) return 0
  const unitPrice = row.orderedValue / row.orderedQty
  return excessQty * unitPrice
}

export function rowStatus(row: BoqControlRow): BoqControlStatus {
  const used = consumedQty(row)
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
