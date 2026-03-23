export type UserRole = 'admin' | 'pm' | 'foreman'

export type BillingStatus = 'draft' | 'pending_review' | 'approved' | 'rejected'

export type ProjectOption = {
  id: string
  name: string
}

export type ContractorOption = {
  id: string
  name: string
}

export type PlotOption = {
  id: string
  name: string
}

export type BillableJob = {
  id: string
  totalBoq: number
  paid: number
  remaining: number
  boq_master: {
    item_name: string
    unit: string
  } | null
  plots: {
    name: string
  } | null
  previous_progress?: number
}

export type BillingAdjustmentForm = {
  type: 'addition' | 'deduction'
  description: string
  plot_name?: string
  unit: string
  quantity: number
  unit_price: number
  signature?: {
    user_id?: string
    full_name?: string
    role?: string
    at?: string
    action?: string
  } | null
  raw_description?: string
}

export type BillingAdjustmentRecord = BillingAdjustmentForm & {
  id?: string | null
}

export type ProgressHistoryItem = {
  id: string
  amount: number
  progress_percent: number | null
  billing_date?: string
  created_at?: string
  doc_no?: string | number
  status?: string
}

export type SelectedBillingJobState = {
  progress: string
  request_amount: number
}

export type BillingJobPayload = {
  id: string
  request_amount: number
  progress_percent?: number | null
}

export type BillingApprovalJobPayload = BillingJobPayload & {
  job_assignment_id?: string
}

export type BillingApprovalPayload = {
  billing_date: string
  selected_jobs: BillingApprovalJobPayload[]
  adjustments: BillingAdjustmentRecord[]
  total_work_amount: number
  total_add_amount: number
  total_deduct_amount: number
  wht_percent: number
  retention_percent: number
  net_amount: number
  type?: 'progress' | 'extra_work'
  attachment_urls?: string[] | null
  reason_for_dc?: string | null
}

export type BillingActionSignature = {
  user_id?: string | null
  full_name?: string | null
  role?: string | null
  action?: string | null
  at?: string | null
}

export type BillingUserSummary = {
  id: string
  full_name?: string | null
  email?: string | null
  role?: UserRole | null
}
