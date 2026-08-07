'use server'

import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import {
  UNASSIGNED_CONTRACTOR_ID,
  computeJobBudget,
  resolveJobPricePerUnit,
  toNumber,
  type LaborLedgerEntry,
  type LaborTransaction,
} from '@/lib/labor-budget'

export type LaborLedgerFilters = {
  projectId?: string
  contractorId?: string
  plotGroupId?: string
  plotId?: string
}

export type LaborLedgerResult = {
  entries: LaborLedgerEntry[]
  groups: { id: string; name: string; plotIds: string[] }[]
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

// PostgREST types embedded relations as `T | T[]` depending on cardinality
// inference, so each one is declared with both shapes and narrowed through
// `asSingle` — the same pattern as `actions/billing/lookups.ts`.
type Nested<T> = T | T[] | null

type JobRow = {
  id: string
  status: string | null
  contractor_id: string | null
  agreed_price_per_unit: number | null
  boq_master: Nested<{
    item_name: string | null
    unit: string | null
    quantity: number | null
    price_per_unit: number | null
  }>
  plots: Nested<{
    id: string
    name: string | null
    project_id: string | null
    projects: Nested<{ name: string | null }>
    house_models: Nested<{ name: string | null; code: string | null }>
  }>
  contractors: Nested<{ id: string; name: string | null }>
  payments: Array<{
    id: string
    amount: number | null
    payment_date: string | null
    billing_id: string | null
  }> | null
}

type PlotGroupRow = {
  id: string
  name: string | null
  project_id: string
  plot_group_members: Array<{ plot_id: string }> | null
}

type LedgerBillingRow = {
  id: string
  doc_no: string | number | null
  billing_date: string | null
  status: string | null
  paid_out_at: string | null
}

type BillingJobRow = {
  billing_id: string
  job_assignment_id: string
  amount: number | null
  progress_percent: number | null
}

/**
 * Every job assignment as one ledger line, with the approved billings that
 * drew it down attached.
 *
 * Jobs are included regardless of status — an unstarted job is still committed
 * money, so it belongs in a budget view even though `getBillableJobs`
 * (a *billing* view) filters it out.
 *
 * Extra work / DC is deliberately out of scope: it has no BOQ line to draw
 * down, and it already has its own report at `/dashboard/reports/dc-history`.
 */
export async function getLaborLedger(filters: LaborLedgerFilters = {}): Promise<LaborLedgerResult> {
  await requireModuleAccess('reports')
  const supabase = await createClient()

  let jobsQuery = supabase
    .from('job_assignments')
    .select(`
      id,
      status,
      contractor_id,
      agreed_price_per_unit,
      boq_master:boq_master!job_assignments_boq_item_id_fkey (item_name, unit, quantity, price_per_unit),
      plots!inner (id, name, project_id, projects (name), house_models (name, code)),
      contractors (id, name),
      payments (id, amount, payment_date, billing_id)
    `)

  if (filters.projectId) jobsQuery = jobsQuery.eq('plots.project_id', filters.projectId)
  if (filters.contractorId) jobsQuery = jobsQuery.eq('contractor_id', filters.contractorId)
  if (filters.plotId) jobsQuery = jobsQuery.eq('plots.id', filters.plotId)

  let groupsQuery = supabase
    .from('plot_groups')
    .select('id, name, project_id, plot_group_members (plot_id)')
    .order('name')
  if (filters.projectId) groupsQuery = groupsQuery.eq('project_id', filters.projectId)

  // Only `approved` and `pending_review` matter here: approved is spend,
  // pending_review is money in flight. Rejected/draft bills are noise.
  // These rows exist purely to label and date each payment — the money itself
  // comes from `payments`.
  let billingsQuery = supabase
    .from('billings')
    .select('id, doc_no, billing_date, status, paid_out_at')
    .in('status', ['approved', 'pending_review'])
  if (filters.projectId) billingsQuery = billingsQuery.eq('project_id', filters.projectId)
  if (filters.contractorId) billingsQuery = billingsQuery.eq('contractor_id', filters.contractorId)

  const [jobsRes, groupsRes, billingsRes] = await Promise.all([jobsQuery, groupsQuery, billingsQuery])

  if (jobsRes.error) throw new Error(jobsRes.error.message)
  if (groupsRes.error) throw new Error(groupsRes.error.message)
  if (billingsRes.error) throw new Error(billingsRes.error.message)

  const jobRows = (jobsRes.data || []) as unknown as JobRow[]
  const groupRows = (groupsRes.data || []) as unknown as PlotGroupRow[]
  const billingRows = (billingsRes.data || []) as unknown as LedgerBillingRow[]

  // ---- plot -> batch lookup -------------------------------------------------
  const groups = groupRows.map((group) => ({
    id: String(group.id),
    name: String(group.name || ''),
    plotIds: (group.plot_group_members || []).map((m) => String(m.plot_id)),
  }))

  const groupByPlotId = new Map<string, { id: string; name: string }>()
  for (const group of groups) {
    for (const plotId of group.plotIds) groupByPlotId.set(plotId, { id: group.id, name: group.name })
  }

  // ---- billing_jobs: per-job progress + the pending-approval pipeline -------
  const billingById = new Map<string, LedgerBillingRow>(billingRows.map((b) => [String(b.id), b]))
  const billingIds = Array.from(billingById.keys())

  let billingJobRows: BillingJobRow[] = []
  if (billingIds.length > 0) {
    const { data, error } = await supabase
      .from('billing_jobs')
      .select('billing_id, job_assignment_id, amount, progress_percent')
      .in('billing_id', billingIds)
    if (error) throw new Error(error.message)
    billingJobRows = (data || []) as unknown as BillingJobRow[]
  }

  // Progress % lives on billing_jobs, but the authoritative spent amount is
  // `payments` (what the approve RPC actually wrote). Key by billing+job so a
  // payment can be enriched without trusting billing_jobs for the money.
  const progressByBillingJob = new Map<string, number | null>()
  const pendingByJob = new Map<string, number>()
  for (const row of billingJobRows) {
    const billingId = String(row.billing_id)
    const jobId = String(row.job_assignment_id)
    progressByBillingJob.set(
      `${billingId}|${jobId}`,
      row.progress_percent == null ? null : toNumber(row.progress_percent)
    )
    if (billingById.get(billingId)?.status === 'pending_review') {
      pendingByJob.set(jobId, (pendingByJob.get(jobId) || 0) + toNumber(row.amount))
    }
  }

  // ---- ledger entries -------------------------------------------------------
  const entries: LaborLedgerEntry[] = jobRows.map((job) => {
    const boq = asSingle(job.boq_master)
    const plot = asSingle(job.plots)
    const contractor = asSingle(job.contractors)
    const project = asSingle(plot?.projects)
    const houseModel = asSingle(plot?.house_models)

    const plotId = plot?.id ? String(plot.id) : null
    const plotName = plot?.name || 'ไม่ระบุแปลง'
    const batch = plotId ? groupByPlotId.get(plotId) : undefined

    const quantity = toNumber(boq?.quantity)
    const pricePerUnit = resolveJobPricePerUnit(job.agreed_price_per_unit, boq?.price_per_unit)
    const budget = computeJobBudget(quantity, job.agreed_price_per_unit, boq?.price_per_unit)

    const transactions: LaborTransaction[] = (job.payments || [])
      .map((payment): LaborTransaction => {
        const billingId = payment.billing_id ? String(payment.billing_id) : null
        const bill = billingId ? billingById.get(billingId) : null
        return {
          id: String(payment.id),
          billingId,
          docNo: bill?.doc_no == null ? null : String(bill.doc_no),
          date: bill?.billing_date || payment.payment_date || null,
          amount: toNumber(payment.amount),
          progressPercent: billingId ? progressByBillingJob.get(`${billingId}|${String(job.id)}`) ?? null : null,
          status: bill?.status || 'approved',
          paidOutAt: bill?.paid_out_at || null,
        }
      })
      .sort((a: LaborTransaction, b: LaborTransaction) => {
        const ta = new Date(a.date || 0).getTime()
        const tb = new Date(b.date || 0).getTime()
        if (ta !== tb) return ta - tb
        return String(a.docNo || '').localeCompare(String(b.docNo || ''), undefined, { numeric: true })
      })

    const approved = transactions.reduce((sum, tx) => sum + tx.amount, 0)
    const pending = pendingByJob.get(String(job.id)) || 0

    return {
      jobId: String(job.id),
      projectId: plot?.project_id ? String(plot.project_id) : null,
      projectName: project?.name || 'ไม่ระบุโครงการ',
      plotId,
      plotName,
      houseModel: houseModel?.name || '',
      groupId: batch?.id || null,
      groupName: batch?.name || '',
      contractorId: job.contractor_id ? String(job.contractor_id) : UNASSIGNED_CONTRACTOR_ID,
      contractorName: contractor?.name || 'ยังไม่ระบุผู้รับเหมา',
      itemName: boq?.item_name || 'ไม่ระบุรายการ',
      unit: boq?.unit || '',
      quantity,
      pricePerUnit,
      pricingSource: job.agreed_price_per_unit != null ? 'assignment' : 'boq_master',
      jobStatus: job.status || 'pending',
      budget,
      approved,
      pending,
      remaining: budget - approved,
      percent: budget > 0 ? (approved / budget) * 100 : 0,
      transactions,
    }
  })

  // A batch filter is applied last: it spans plots, so it can't be pushed into
  // the per-table queries above without losing the group membership join.
  if (filters.plotGroupId) {
    return {
      entries: entries.filter((entry) => entry.groupId === filters.plotGroupId),
      groups,
    }
  }

  return { entries, groups }
}

export async function getLaborLedgerOptions() {
  await requireModuleAccess('reports')
  const supabase = await createClient()

  const [projects, contractors, plotGroups] = await Promise.all([
    supabase.from('projects').select('id, name').order('name'),
    supabase.from('contractors').select('id, name').order('name'),
    supabase.from('plot_groups').select('id, name, project_id').order('name'),
  ])

  if (projects.error) throw new Error(projects.error.message)
  if (contractors.error) throw new Error(contractors.error.message)
  if (plotGroups.error) throw new Error(plotGroups.error.message)

  return {
    projects: projects.data || [],
    contractors: contractors.data || [],
    plotGroups: plotGroups.data || [],
  }
}
