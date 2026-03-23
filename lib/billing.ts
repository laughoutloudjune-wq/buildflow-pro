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

export function validateBillingPayload(payload: BillingPayload): ValidatedBillingPayload {
  const project_id = String(payload.project_id || '').trim()
  const contractor_id = String(payload.contractor_id || '').trim()
  const billing_date = String(payload.billing_date || '').trim()
  const type: BillingRequestType = payload.type === 'extra_work' ? 'extra_work' : 'progress'

  if (!project_id) throw new Error('Project is required')
  if (!contractor_id) throw new Error('Contractor is required')
  if (!billing_date) throw new Error('Billing date is required')

  const selected_jobs = Array.isArray(payload.selected_jobs)
    ? payload.selected_jobs
        .map((job) => ({
          id: String(job.id || '').trim(),
          progress_percent: job.progress_percent == null ? null : toNumber(job.progress_percent),
          request_amount: Math.max(0, toNumber(job.request_amount)),
        }))
        .filter((job) => job.id)
    : []

  const adjustments = Array.isArray(payload.adjustments)
    ? payload.adjustments.map((adj): BillingAdjustmentInput => ({
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

  const total_add_amount =
    payload.total_add_amount ??
    adjustments
      .filter((adj) => adj.type === 'addition')
      .reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)

  const total_deduct_amount =
    payload.total_deduct_amount ??
    adjustments
      .filter((adj) => adj.type === 'deduction')
      .reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)

  const total_work_amount =
    type === 'extra_work'
      ? 0
      : payload.total_work_amount ?? selected_jobs.reduce((sum, job) => sum + job.request_amount, 0)

  const net_amount =
    payload.net_amount ?? total_work_amount + total_add_amount - total_deduct_amount

  return {
    ...payload,
    project_id,
    contractor_id,
    billing_date,
    type,
    selected_jobs,
    adjustments,
    total_work_amount: toNumber(total_work_amount),
    total_add_amount: toNumber(total_add_amount),
    total_deduct_amount: toNumber(total_deduct_amount),
    net_amount: toNumber(net_amount),
  }
}
