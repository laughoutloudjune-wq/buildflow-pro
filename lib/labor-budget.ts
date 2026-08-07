/**
 * Labor budget vs. actual — the shared math behind the labor ledger report.
 *
 * "Budget" is the BOQ commitment for a job assignment; "approved" is what a PM
 * has actually signed off (which is exactly what `payments` records — the
 * approve RPC writes one payment row per billing_jobs row).
 *
 * Extra work / DC is out of scope here. It has no BOQ line to draw down, so
 * folding it in would make every contractor with a single DC look over budget,
 * and it already has a dedicated report at `/dashboard/reports/dc-history`.
 */

export type LaborTotals = {
  /** BOQ commitment: quantity x effective price per unit. */
  budget: number
  /** Approved by a PM (mirrors `payments`). */
  approved: number
  /** Submitted but not yet approved — money in flight, not yet spent. */
  pending: number
  /** budget - approved. Negative means billed past the BOQ. */
  remaining: number
}

export type LaborTransaction = {
  id: string
  billingId: string | null
  docNo: string | null
  date: string | null
  amount: number
  progressPercent: number | null
  status: string | null
  paidOutAt: string | null
}

export type LaborLedgerEntry = {
  jobId: string
  projectId: string | null
  projectName: string
  plotId: string | null
  plotName: string
  houseModel: string
  groupId: string | null
  groupName: string
  contractorId: string
  contractorName: string
  itemName: string
  unit: string
  quantity: number
  pricePerUnit: number
  /** Whether the price came from a negotiated rate or straight off the BOQ. */
  pricingSource: 'assignment' | 'boq_master'
  jobStatus: string
  budget: number
  approved: number
  pending: number
  remaining: number
  /** approved / budget, as a percentage. 0 when there is no budget. */
  percent: number
  transactions: LaborTransaction[]
}

export const UNASSIGNED_CONTRACTOR_ID = '__unassigned__'
export const UNGROUPED_BATCH_ID = '__ungrouped__'

export function toNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function emptyLaborTotals(): LaborTotals {
  return { budget: 0, approved: 0, pending: 0, remaining: 0 }
}

/**
 * The effective price for a job: a negotiated `agreed_price_per_unit` wins
 * over the BOQ rate. Kept in one place so this can't drift from the identical
 * rule in `getJobFinancials` and `getBillableJobs`.
 */
export function resolveJobPricePerUnit(
  agreedPricePerUnit: number | null | undefined,
  boqPricePerUnit: number | null | undefined
) {
  return toNumber(agreedPricePerUnit ?? boqPricePerUnit ?? 0)
}

export function computeJobBudget(
  quantity: number | null | undefined,
  agreedPricePerUnit: number | null | undefined,
  boqPricePerUnit: number | null | undefined
) {
  return toNumber(quantity) * resolveJobPricePerUnit(agreedPricePerUnit, boqPricePerUnit)
}

export function sumLaborTotals(entries: LaborLedgerEntry[]): LaborTotals {
  const totals = entries.reduce((acc, entry) => {
    acc.budget += entry.budget
    acc.approved += entry.approved
    acc.pending += entry.pending
    return acc
  }, emptyLaborTotals())

  totals.remaining = totals.budget - totals.approved
  return totals
}
