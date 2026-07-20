'use server'

import { createClient } from '@/lib/supabase/server'
import { normalizeAdjustmentsWithPlot } from '@/actions/_shared/billing-adjustments'
import { getPlotDetailMap, getPlotNameMap } from '@/actions/_shared/plot-maps'
import { getCurrentUser } from '@/actions/_shared/user-role'
import type { BillingAdjustmentRecord, BillingUserSummary } from '@/lib/types/billing'

type BillingReportRow = {
  id: string
  type?: string | null
  status?: string | null
  doc_no?: string | number | null
  billing_date?: string | null
  created_at?: string | null
  net_amount?: number | null
  total_work_amount?: number | null
  total_add_amount?: number | null
  total_deduct_amount?: number | null
  wht_percent?: number | null
  retention_percent?: number | null
  reason_for_dc?: string | null
  attachment_urls?: string[] | null
  plot_id?: string | null
  submitted_by?: string | null
  approved_by?: string | null
  approved_at?: string | null
  paid_out_at?: string | null
  paid_out_by?: string | null
  wht_applied?: boolean | null
  retention_applied?: boolean | null
  deduct_applied?: boolean | null
  billing_jobs?: Array<{
    id: string
    amount?: number | null
    progress_percent?: number | null
    job_assignments?: {
      id?: string
      plots?: {
        id?: string
        name?: string | null
        house_models?: { name?: string | null; code?: string | null } | null
      } | null
      payments?: Array<{ amount?: number | null }> | null
      agreed_price_per_unit?: number | null
      boq_master?: {
        item_name?: string | null
        unit?: string | null
        quantity?: number | null
        price_per_unit?: number | null
      } | null
    } | null
  }>
  billing_adjustments?: BillingAdjustmentRecord[] | null
  projects?: { name?: string | null } | null
  contractors?: { name?: string | null; address?: string | null; phone?: string | null } | null
  plots?: { name?: string | null; house_models?: { name?: string | null; code?: string | null } | null } | null
}

function getPlotIds(rows: BillingReportRow[]) {
  return rows.map((billing) => billing.plot_id)
}

function withPlotNames(rows: BillingReportRow[], plotMap: Map<string, string>) {
  return rows.map((billing) => ({
    ...billing,
    billing_adjustments: normalizeAdjustmentsWithPlot(billing.billing_adjustments),
    plots: billing.plot_id ? { name: plotMap.get(billing.plot_id) || null } : null,
  }))
}

export async function getBillingsByCreator() {
  const supabase = await createClient()
  const user = await getCurrentUser()
  if (!user) throw new Error('User not found')

  const { data, error } = await supabase
    .from('billings')
    .select(`
      *,
      projects (name),
      contractors (name),
      billing_jobs (
        id,
        job_assignments (
          plots (name),
          boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name)
        )
      ),
      billing_adjustments (id, type, description)
    `)
    .or(`created_by.eq.${user.id},submitted_by.eq.${user.id}`)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)

  const rows = (data || []) as BillingReportRow[]
  const plotMap = await getPlotNameMap(supabase, getPlotIds(rows))
  return withPlotNames(rows, plotMap)
}

export async function getExtraWorkReport(
  filters: {
    projectId?: string
    plotId?: string
    reason?: string
    dateFrom?: string
    dateTo?: string
  } = {}
) {
  const supabase = await createClient()
  let query = supabase
    .from('billings')
    .select(`
      *,
      projects (name),
      contractors (name),
      billing_adjustments (id, type, description, unit, quantity, unit_price)
    `)
    .or('type.eq.extra_work,total_add_amount.gt.0,total_deduct_amount.gt.0')
    .order('billing_date', { ascending: false })

  if (filters.projectId) query = query.eq('project_id', filters.projectId)
  if (filters.plotId) query = query.eq('plot_id', filters.plotId)
  if (filters.reason) query = query.eq('reason_for_dc', filters.reason)
  if (filters.dateFrom) query = query.gte('billing_date', filters.dateFrom)
  if (filters.dateTo) query = query.lte('billing_date', filters.dateTo)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const rows = (data || []) as BillingReportRow[]
  const plotMap = await getPlotNameMap(supabase, getPlotIds(rows))
  return rows.map((billing) => ({
    ...billing,
    billing_adjustments: normalizeAdjustmentsWithPlot(billing.billing_adjustments),
    plots: billing.plot_id ? { name: plotMap.get(billing.plot_id) || null } : null,
  }))
}

export async function getApprovedContractorCycleReport(
  filters: {
    contractorId?: string
    projectId?: string
    dateFrom?: string
    dateTo?: string
    includeUnpaidOutsideRange?: boolean
  } = {}
) {
  const supabase = await createClient()
  let query = supabase
    .from('billings')
    .select(`
      *,
      projects (name),
      contractors (name),
      billing_jobs (
        id,
        amount,
        progress_percent,
        job_assignments (
          id,
          agreed_price_per_unit,
          plots (name, house_models (name, code)),
          boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, unit, quantity, price_per_unit)
        )
      ),
      billing_adjustments (id, type, description, unit, quantity, unit_price)
    `)
    .eq('status', 'approved')
    .order('billing_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (filters.contractorId) query = query.eq('contractor_id', filters.contractorId)
  if (filters.projectId) query = query.eq('project_id', filters.projectId)

  // By default the date range is strict, matching what the user picked. When
  // includeUnpaidOutsideRange is set, unpaid approved bills are shown even
  // outside the window (e.g. to catch up on everything still owed) — an
  // opt-in surfaced as a checkbox in the UI rather than always-on, since
  // silently ignoring the selected range surprised users reconciling a
  // specific cycle.
  if (filters.includeUnpaidOutsideRange && (filters.dateFrom || filters.dateTo)) {
    const dateConditions: string[] = []
    if (filters.dateFrom) dateConditions.push(`billing_date.gte.${filters.dateFrom}`)
    if (filters.dateTo) dateConditions.push(`billing_date.lte.${filters.dateTo}`)
    query = query.or(`and(${dateConditions.join(',')}),paid_out_at.is.null`)
  } else {
    if (filters.dateFrom) query = query.gte('billing_date', filters.dateFrom)
    if (filters.dateTo) query = query.lte('billing_date', filters.dateTo)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const rows = (data || []) as BillingReportRow[]
  const plotMap = await getPlotDetailMap(supabase, getPlotIds(rows))
  return rows.map((billing) => ({
    ...billing,
    billing_adjustments: normalizeAdjustmentsWithPlot(billing.billing_adjustments),
    plots: billing.plot_id ? plotMap.get(billing.plot_id) || null : null,
  }))
}

export async function getPlotHistoryReport(
  filters: {
    projectId?: string
    plotId?: string
    dateFrom?: string
    dateTo?: string
  } = {}
) {
  const supabase = await createClient()
  let query = supabase
    .from('billings')
    .select(`
      *,
      projects (name),
      contractors (name),
      billing_jobs (
        id,
        amount,
        progress_percent,
        job_assignments (
          plots (id, name, house_models (name, code)),
          boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, unit)
        )
      ),
      billing_adjustments (id, type, description, unit, quantity, unit_price)
    `)
    .eq('status', 'approved')
    .order('billing_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (filters.projectId) query = query.eq('project_id', filters.projectId)
  if (filters.dateFrom) query = query.gte('billing_date', filters.dateFrom)
  if (filters.dateTo) query = query.lte('billing_date', filters.dateTo)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const rawRows = (data || []) as BillingReportRow[]
  const plotMap = await getPlotDetailMap(supabase, getPlotIds(rawRows))

  const rows = rawRows.map((billing) => ({
    ...billing,
    billing_adjustments: normalizeAdjustmentsWithPlot(billing.billing_adjustments),
    plots: billing.plot_id ? plotMap.get(billing.plot_id) || null : null,
  }))

  if (!filters.plotId) return rows

  return rows.filter((billing) => {
    if (billing.plot_id && String(billing.plot_id) === String(filters.plotId)) return true
    const matchedJob = (billing.billing_jobs || []).some((job) => String(job.job_assignments?.plots?.id || '') === String(filters.plotId))
    return matchedJob
  })
}

export async function getBillings() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('billings')
    .select(`
      *,
      projects (name),
      contractors (name),
      billing_jobs (
        id,
        job_assignments (
          plots (name),
          boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name)
        )
      ),
      billing_adjustments (id, type, description)
    `)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  const rows = (data || []) as BillingReportRow[]
  const plotMap = await getPlotNameMap(supabase, getPlotIds(rows))
  return withPlotNames(rows, plotMap)
}

export async function getBillingById(id: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('billings')
    .select(`
      *,
      projects (name),
      contractors (name, address, phone),
      billing_jobs (
        id,
        amount,
        progress_percent,
        job_assignments (
          id,
          agreed_price_per_unit,
          plots (name),
          payments (amount),
          boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, unit, quantity, price_per_unit)
        )
      ),
      billing_adjustments (id, type, description, unit, quantity, unit_price)
    `)
    .eq('id', id)
    .single()

  if (error) {
    console.error('Error fetching billing details:', error)
    throw new Error(`Could not fetch billing details: ${error.message}`)
  }

  if (data?.plot_id) {
    const plotMap = await getPlotNameMap(supabase, [data.plot_id])
    data.plots = { name: plotMap.get(data.plot_id) || null }
  } else if (data) {
    data.plots = null
  }

  if (data?.submitted_by || data?.approved_by) {
    const userIds = [data.submitted_by, data.approved_by].filter(Boolean)
    const { data: users, error: usersError } = await supabase.from('profiles').select('id, full_name, email').in('id', userIds)

    if (usersError) {
      console.error('Error fetching billing users:', usersError)
    } else if (users) {
      const byId = new Map((users as BillingUserSummary[]).map((user) => [user.id, user]))
      data.submitted_by_user = byId.get(data.submitted_by) || null
      data.approved_by_user = byId.get(data.approved_by) || null
    }
  }

  type BillingJob = {
    id: string
    amount: number
    progress_percent: number | null
    job_assignments: {
      id: string
      agreed_price_per_unit: number | null
      plots: { name: string } | null
      payments: { amount: number }[]
      boq_master: {
        item_name: string
        unit: string
        quantity: number
        price_per_unit: number
      } | null
    } | null
  }

  if (data && data.billing_jobs) {
    const processedJobs = data.billing_jobs.map((billingJob: BillingJob) => {
      const job = billingJob.job_assignments
      if (!job) return { ...billingJob, totalBoq: 0, paid: 0, previous_progress: 0 }

      const pricePerUnit = (job.agreed_price_per_unit ?? job.boq_master?.price_per_unit) || 0
      const totalBoq = (job.boq_master?.quantity || 0) * pricePerUnit
      const paid = (job.payments || []).reduce((sum: number, payment) => sum + (payment.amount || 0), 0)
      const previous_progress = totalBoq > 0 ? (paid / totalBoq) * 100 : 0

      return {
        ...billingJob,
        totalBoq,
        paid,
        previous_progress,
      }
    })

    return { ...data, billing_jobs: processedJobs, billing_adjustments: normalizeAdjustmentsWithPlot(data.billing_adjustments) }
  }

  return data ? { ...data, billing_adjustments: normalizeAdjustmentsWithPlot(data.billing_adjustments) } : data
}
