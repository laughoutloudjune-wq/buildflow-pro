'use server'

import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'
import { fetchAllRows } from '@/actions/_shared/fetch-all-rows'
import { fetchLatestJobProgress } from '@/actions/_shared/job-progress'
import {
  expectedPercentAt,
  progressState,
  summarizeProgress,
  type ProgressJob,
  type ProgressState,
} from '@/lib/cost-control/progress'
import type { ControlScope } from '@/lib/procurement/boqControl'

export type CostBoardRow = {
  plotId: string
  plotName: string
  houseModel: string
  jobCount: number
  /** Labor figures are null when the viewer may not see labor cost. */
  contract: number | null
  paid: number | null
  earned: number | null
  expectedPercent: number | null
  actualPercent: number | null
  paidPercent: number | null
  paidAhead: number | null
  paidAheadJobs: number
  health: ProgressState
  extraWorkApproved: number | null
  extraWorkPending: number | null
  /** Baht of stock withdrawn for this plot (a batch's withdrawals split evenly across its plots). */
  materialUsed: number
}

export type CostBoardTotals = {
  contract: number | null
  paid: number | null
  paidAhead: number | null
  paidAheadJobs: number
  extraWorkApproved: number | null
  extraWorkPending: number | null
  materialUsed: number
  /** Withdrawals naming neither a plot nor a batch: cost that cannot be charged to a house. */
  materialNoPlot: number
  /** Approved billings (progress and extra work) not yet paid out. */
  toPayOut: number | null
  toPayOutCount: number
}

type PlotRow = {
  id: string
  name: string
  target_completion_date: string | null
  house_models: { name: string | null } | { name: string | null }[] | null
}

type JobRow = {
  id: string
  plot_id: string
  created_at: string
  agreed_price_per_unit: number | null
  boq_master: { quantity: number | null; price_per_unit: number | null; contractor_type_id: number | null } | { quantity: number | null; price_per_unit: number | null; contractor_type_id: number | null }[] | null
  payments: { amount: number | null }[] | null
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function toNumber(value: number | string | null | undefined): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * The project cost board: one row per plot with progress (expected / actual /
 * paid), labor (paid vs earned), extra work and material used. Built from the
 * same sources as the plot cost tab - getPlotDetailBundle - through the same
 * helpers (summarizeProgress, fetchLatestJobProgress), so a plot's row and its
 * detail page can never disagree.
 */
export async function getCostBoard(
  scope: ControlScope,
  opts: { canSeeLabor: boolean }
): Promise<{ rows: CostBoardRow[]; totals: CostBoardTotals }> {
  await requireModuleAccess('cost_control')
  const supabase = await createClient()
  const { canSeeLabor } = opts

  const plotsRes = await supabase
    .from('plots')
    .select('id, name, target_completion_date, house_models (name)')
    .eq('project_id', scope.projectId)
    .order('name')
  if (plotsRes.error) throw new Error(plotsRes.error.message)

  const groupMembersRes = await supabase.from('plot_group_members').select('group_id, plot_id')
  if (groupMembersRes.error) throw new Error(groupMembersRes.error.message)
  const groupMembers = new Map<string, string[]>()
  for (const m of groupMembersRes.data || []) {
    const list = groupMembers.get(m.group_id) || []
    list.push(m.plot_id)
    groupMembers.set(m.group_id, list)
  }

  // Which plots the picker's scope covers.
  let inScope: Set<string> | null = null
  if (scope.plotIds && scope.plotIds.length > 0) inScope = new Set(scope.plotIds)
  else if (scope.plotGroupId) inScope = new Set(groupMembers.get(scope.plotGroupId) || [])
  const plots = ((plotsRes.data || []) as unknown as PlotRow[]).filter((p) => (inScope ? inScope.has(p.id) : true))
  const plotIdSet = new Set(plots.map((p) => p.id))

  // ---- material used (stock withdrawals, in baht) -------------------------
  type CostLine = { plot_id: string | null; plot_group_id: string | null; value: number | string | null }
  const costLines = await fetchAllRows<CostLine>(
    (from, to) =>
      supabase
        .from('plot_cost_lines')
        .select('plot_id, plot_group_id, value')
        .eq('project_id', scope.projectId)
        .range(from, to) as unknown as PromiseLike<{ data: CostLine[] | null; error: { message: string } | null }>
  )
  const materialByPlot = new Map<string, number>()
  let materialUsed = 0
  let materialNoPlot = 0
  for (const line of costLines) {
    const value = toNumber(line.value)
    if (line.plot_id) {
      if (plotIdSet.has(line.plot_id)) {
        materialByPlot.set(line.plot_id, (materialByPlot.get(line.plot_id) || 0) + value)
        materialUsed += value
      }
    } else if (line.plot_group_id) {
      const members = groupMembers.get(line.plot_group_id) || []
      const share = members.length > 0 ? value / members.length : 0
      for (const plotId of members) {
        if (!plotIdSet.has(plotId)) continue
        materialByPlot.set(plotId, (materialByPlot.get(plotId) || 0) + share)
        materialUsed += share
      }
    } else if (!inScope) {
      materialNoPlot += value
    }
  }

  // ---- labor, progress, extra work (labor viewers only) -------------------
  const jobsByPlot = new Map<string, ProgressJob[]>()
  const jobValueByPlotType = new Map<string, Map<number, number>>()
  const startByPlot = new Map<string, string>()
  const extraApproved = new Map<string, number>()
  const extraPending = new Map<string, number>()
  let toPayOut: number | null = null
  let toPayOutCount = 0
  const phasesByPlot = new Map<string, { contractor_type_id: number; planned_start_date: string; planned_end_date: string }[]>()

  if (canSeeLabor) {
    const [jobs, progress, extraRes, payoutRes, phaseRes] = await Promise.all([
      fetchAllRows<JobRow>(
        (from, to) =>
          supabase
            .from('job_assignments')
            .select(
              'id, plot_id, created_at, agreed_price_per_unit, boq_master:boq_master!job_assignments_boq_item_id_fkey (quantity, price_per_unit, contractor_type_id), payments (amount), plots!inner (project_id)'
            )
            .eq('plots.project_id', scope.projectId)
            .range(from, to) as unknown as PromiseLike<{ data: JobRow[] | null; error: { message: string } | null }>
      ),
      fetchLatestJobProgress(supabase, { projectId: scope.projectId }),
      supabase
        .from('billings')
        .select('plot_id, total_work_amount, status')
        .eq('project_id', scope.projectId)
        .eq('type', 'extra_work')
        .in('status', ['approved', 'pending_review']),
      supabase.from('billings').select('net_amount').eq('project_id', scope.projectId).eq('status', 'approved').is('paid_out_at', null),
      supabase
        .from('plot_phase_schedule')
        .select('plot_id, contractor_type_id, planned_start_date, planned_end_date')
        .in('plot_id', plots.map((p) => p.id)),
    ])
    if (extraRes.error) throw new Error(extraRes.error.message)
    if (payoutRes.error) throw new Error(payoutRes.error.message)
    if (phaseRes.error) throw new Error(phaseRes.error.message)

    for (const job of jobs) {
      if (!plotIdSet.has(job.plot_id)) continue
      const boq = asSingle(job.boq_master)
      const value = toNumber(boq?.quantity) * toNumber(job.agreed_price_per_unit ?? boq?.price_per_unit)
      const paid = (job.payments || []).reduce((sum, p) => sum + toNumber(p.amount), 0)
      const list = jobsByPlot.get(job.plot_id) || []
      list.push({ value, progressPercent: progress.get(job.id)?.percent ?? null, paid })
      jobsByPlot.set(job.plot_id, list)

      const typeId = boq?.contractor_type_id
      if (typeId != null) {
        const byType = jobValueByPlotType.get(job.plot_id) || new Map<number, number>()
        byType.set(typeId, (byType.get(typeId) || 0) + value)
        jobValueByPlotType.set(job.plot_id, byType)
      }
      const prev = startByPlot.get(job.plot_id)
      if (!prev || job.created_at < prev) startByPlot.set(job.plot_id, job.created_at)
    }

    for (const e of extraRes.data || []) {
      if (!e.plot_id || !plotIdSet.has(e.plot_id)) continue
      const target = e.status === 'approved' ? extraApproved : extraPending
      target.set(e.plot_id, (target.get(e.plot_id) || 0) + toNumber(e.total_work_amount))
    }

    toPayOut = (payoutRes.data || []).reduce((sum, b) => sum + toNumber(b.net_amount), 0)
    toPayOutCount = (payoutRes.data || []).length

    for (const ph of phaseRes.data || []) {
      const list = phasesByPlot.get(ph.plot_id) || []
      list.push(ph)
      phasesByPlot.set(ph.plot_id, list)
    }
  }

  // ---- assemble rows --------------------------------------------------------
  const today = new Date().toISOString()
  const rows: CostBoardRow[] = plots.map((plot) => {
    const jobs = jobsByPlot.get(plot.id) || []
    const summary = summarizeProgress(jobs)
    const totalValue = summary.contract
    const byType = jobValueByPlotType.get(plot.id)
    const phases = (phasesByPlot.get(plot.id) || []).map((ph) => ({
      plannedStart: ph.planned_start_date,
      plannedEnd: ph.planned_end_date,
      weight: totalValue > 0 ? (byType?.get(ph.contractor_type_id) || 0) / totalValue : 0,
    }))
    const expectedPercent = canSeeLabor
      ? expectedPercentAt({ today, startDate: startByPlot.get(plot.id) ?? null, targetDate: plot.target_completion_date, phases })
      : null
    return {
      plotId: plot.id,
      plotName: plot.name,
      houseModel: asSingle(plot.house_models)?.name || '',
      jobCount: jobs.length,
      contract: canSeeLabor ? summary.contract : null,
      paid: canSeeLabor ? summary.paid : null,
      earned: canSeeLabor ? summary.earned : null,
      expectedPercent,
      actualPercent: canSeeLabor ? summary.actualPercent : null,
      paidPercent: canSeeLabor ? summary.paidPercent : null,
      paidAhead: canSeeLabor ? summary.paidAhead : null,
      paidAheadJobs: summary.paidAheadJobs,
      health: canSeeLabor ? progressState(summary, expectedPercent) : 'unknown',
      extraWorkApproved: canSeeLabor ? extraApproved.get(plot.id) || 0 : null,
      extraWorkPending: canSeeLabor ? extraPending.get(plot.id) || 0 : null,
      materialUsed: materialByPlot.get(plot.id) || 0,
    }
  })

  const sum = (pick: (r: CostBoardRow) => number | null) => (canSeeLabor ? rows.reduce((s, r) => s + (pick(r) || 0), 0) : null)
  const totals: CostBoardTotals = {
    contract: sum((r) => r.contract),
    paid: sum((r) => r.paid),
    paidAhead: sum((r) => r.paidAhead),
    paidAheadJobs: rows.reduce((s, r) => s + r.paidAheadJobs, 0),
    extraWorkApproved: sum((r) => r.extraWorkApproved),
    extraWorkPending: sum((r) => r.extraWorkPending),
    materialUsed,
    materialNoPlot,
    toPayOut,
    toPayOutCount,
  }

  return { rows, totals }
}
