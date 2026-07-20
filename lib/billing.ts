export type BillingRequestType = 'progress' | 'extra_work'
export type BillingAdjustmentType = 'addition' | 'deduction'

export type BillingJobInput = {
  id: string
  progress_percent?: number | null
  request_amount: number
}

export type BillingAdjustmentInput = {
  type: BillingAdjustmentType
  description: string
  plot_name?: string
  unit: string
  quantity: number
  unit_price: number
}

export type BillingPayload = {
  project_id: string
  contractor_id: string
  plot_id?: string | null
  billing_date: string
  note?: string
  type?: BillingRequestType
  selected_jobs?: BillingJobInput[]
  adjustments?: BillingAdjustmentInput[]
  total_work_amount?: number
  total_add_amount?: number
  total_deduct_amount?: number
  net_amount?: number
  wht_percent?: number
  retention_percent?: number
  attachment_urls?: string[] | null
  reason_for_dc?: string | null
}

type ValidatedBillingPayload = BillingPayload & {
  type: BillingRequestType
  selected_jobs: BillingJobInput[]
  adjustments: BillingAdjustmentInput[]
  total_work_amount: number
  total_add_amount: number
  total_deduct_amount: number
  net_amount: number
}

function toNumber(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function clampPercent(value: unknown) {
  const n = toNumber(value)
  if (n < 0) return 0
  if (n > 100) return 100
  return n
}

/**
 * Compute canonical billing totals from the line items. Monetary totals are
 * ALWAYS derived server-side — any totals sent by the client are ignored.
 */
export function computeBillingTotals(
  type: BillingRequestType,
  selected_jobs: BillingJobInput[],
  adjustments: BillingAdjustmentInput[]
) {
  const total_add_amount = adjustments
    .filter((adj) => adj.type === 'addition')
    .reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)

  const total_deduct_amount = adjustments
    .filter((adj) => adj.type === 'deduction')
    .reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)

  const total_work_amount =
    type === 'extra_work'
      ? 0
      : selected_jobs.reduce((sum, job) => sum + job.request_amount, 0)

  const net_amount = total_work_amount + total_add_amount - total_deduct_amount

  return {
    total_work_amount: toNumber(total_work_amount),
    total_add_amount: toNumber(total_add_amount),
    total_deduct_amount: toNumber(total_deduct_amount),
    net_amount: toNumber(net_amount),
  }
}

export type BillingPayoutFields = {
  type?: string | null
  total_work_amount?: number | null
  total_add_amount?: number | null
  total_deduct_amount?: number | null
  wht_percent?: number | null
  retention_percent?: number | null
  wht_applied?: boolean | null
  retention_applied?: boolean | null
  deduct_applied?: boolean | null
}

/**
 * The actual amount transferred to a contractor, as recorded by the
 * accountant at payout time (`markBillingsAsPaidOut`) — NOT the amount a PM
 * approved. The accountant can choose per-bill whether WHT/retention/deduct
 * actually applied, so this must mirror those flags rather than assuming
 * the PM's approval-time percentages always apply.
 */
export function computeActualPayout(bill: BillingPayoutFields) {
  const work = toNumber(bill.total_work_amount)
  const add = toNumber(bill.total_add_amount)
  const deduct = toNumber(bill.total_deduct_amount)
  const retentionPercent = toNumber(bill.retention_percent)
  const whtPercent = toNumber(bill.wht_percent)

  const base = work + add
  const grossBeforeWht = base - deduct
  const actualDeduct = bill.deduct_applied !== false ? deduct : 0
  const actualRetention = bill.retention_applied !== false ? work * (retentionPercent / 100) : 0
  const actualWht = bill.wht_applied ? grossBeforeWht * (whtPercent / 100) : 0

  return toNumber(base - actualDeduct - actualRetention - actualWht)
}

export function validateBillingPayload(payload: BillingPayload): ValidatedBillingPayload {
  const project_id = String(payload.project_id || '').trim()
  const contractor_id = String(payload.contractor_id || '').trim()
  const billing_date = String(payload.billing_date || '').trim()
  const type: BillingRequestType = payload.type === 'extra_work' ? 'extra_work' : 'progress'

  if (!project_id) throw new Error('Project is required')
  if (!contractor_id) throw new Error('Contractor is required')
  if (!billing_date) throw new Error('Billing date is required')

  const selected_jobs: BillingJobInput[] = Array.isArray(payload.selected_jobs)
    ? payload.selected_jobs
        .map((job) => ({
          id: String(job.id || '').trim(),
          progress_percent: job.progress_percent == null ? null : toNumber(job.progress_percent),
          request_amount: Math.max(0, toNumber(job.request_amount)),
        }))
        .filter((job) => job.id)
    : []

  const adjustments: BillingAdjustmentInput[] = Array.isArray(payload.adjustments)
    ? payload.adjustments.map((adj) => ({
        type: adj.type === 'deduction' ? 'deduction' : 'addition',
        description: String(adj.description || '').trim(),
        plot_name: String(adj.plot_name || '').trim(),
        unit: String(adj.unit || '').trim() || 'unit',
        quantity: Math.max(0, toNumber(adj.quantity)),
        unit_price: Math.max(0, toNumber(adj.unit_price)),
      }))
    : []

  if (type === 'progress' && selected_jobs.length === 0 && adjustments.length === 0) {
    throw new Error('At least one job or adjustment is required')
  }

  if (type === 'extra_work' && adjustments.length === 0) {
    throw new Error('Extra work request must include at least one adjustment')
  }

  // SECURITY: always recompute totals server-side; ignore client-sent values.
  const totals = computeBillingTotals(type, selected_jobs, adjustments)

  return {
    ...payload,
    project_id,
    contractor_id,
    billing_date,
    type,
    selected_jobs,
    adjustments,
    wht_percent: payload.wht_percent == null ? undefined : clampPercent(payload.wht_percent),
    retention_percent:
      payload.retention_percent == null ? undefined : clampPercent(payload.retention_percent),
    ...totals,
  }
}
