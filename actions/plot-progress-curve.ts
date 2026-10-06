'use server'

import { createClient } from '@/lib/supabase/server'
import { requireModuleAccess } from '@/lib/auth/route-access'

export type PlotProgressActualPoint = {
  date: string
  /** Value-weighted % of the plot's total BOQ complete, as of this billing
   * event - not a simple job count, so a big-ticket job (structure) moving
   * 10% shows up more than a small one (paint) moving 10%. */
  actualPercent: number
  /** Cumulative net_amount billed against this plot, running total. */
  cumulativeCost: number
}

/** One planned phase (contractor_type) with a real baseline window, plus its
 * share of the plot's total BOQ value - the weight used to turn a set of
 * phase windows into a single 0-100 planned curve (see buildPhasePlannedPath
 * in the chart component). Only phases with both dates set reach here -
 * plot_phase_schedule's columns are not-null, so a saved row always has
 * both. */
export type PlotPhaseMilestone = {
  contractorTypeId: number
  contractorTypeName: string
  plannedStart: string
  plannedEnd: string
  weight: number
}

export type PlotProgressCurve = {
  /** Earliest job_assignments.created_at for this plot - the planned
   * line's start point. Null when the plot has no jobs yet (nothing to
   * chart). */
  startDate: string | null
  /** plots.target_completion_date - the planned line's end point. Null
   * when nobody has set one yet. Still used as a fallback straight-ramp
   * baseline when phaseMilestones is empty (no per-phase schedule entered
   * yet), and always shown as the "เป้าหมาย" deadline marker regardless. */
  targetDate: string | null
  /** Sum of quantity x effective price across every job - the 100% mark
   * for both the progress and cost curves (cost is shown as % of this, so
   * both series share one 0-100 axis). */
  totalBoqValue: number
  /** One point per approved/paid billing on this plot, chronological. */
  actualPoints: PlotProgressActualPoint[]
  /** Per-phase planned baseline, PM-entered. Empty until someone fills in
   * plot_phase_schedule for this plot - the chart falls back to the old
   * startDate->targetDate straight ramp in that case. */
  phaseMilestones: PlotPhaseMilestone[]
  /** Computed once here (a server action), not with `Date.now()` inside
   * the chart component's render - React's purity rule disallows calling
   * an impure clock function during render, memoized or not. */
  today: string
}

const EMPTY: PlotProgressCurve = { startDate: null, targetDate: null, totalBoqValue: 0, actualPoints: [], phaseMilestones: [], today: new Date().toISOString() }

type CurveJob = {
  id: string
  created_at: string
  agreed_price_per_unit: number | null
  boq_master: { quantity: number | null; price_per_unit: number | null; contractor_type_id: number | null } | null
}

type CurvePhaseSchedule = {
  contractor_type_id: number
  planned_start_date: string
  planned_end_date: string
  contractor_types: { name: string } | null
}

type CurveBilling = {
  billing_date: string | null
  created_at: string
  net_amount: number | null
  billing_jobs: Array<{ job_assignment_id: string | null; progress_percent: number | null }> | null
}

/**
 * Construction-only (D2 - never called for sales). Replays this plot's
 * approved/paid billing history in chronological order to build a real
 * actual-progress-vs-cost S-curve, since there's no stored history of "the
 * plot was N% done on date X" - only the running total each billing_jobs
 * row carries forward. The *shape* of the planned line is not computed here
 * either - it's cheap enough (a sum of per-phase ramps, or a fallback
 * straight line from startDate to targetDate) to derive in the chart
 * component itself; this only supplies the raw phase windows and their
 * value-weights.
 */
export async function getPlotProgressCurve(plotId: string): Promise<PlotProgressCurve> {
  await requireModuleAccess('projects')
  const supabase = await createClient()

  const [plotRes, jobsRes, billingsRes, phaseScheduleRes] = await Promise.all([
    supabase.from('plots').select('target_completion_date').eq('id', plotId).maybeSingle(),
    supabase
      .from('job_assignments')
      .select('id, created_at, agreed_price_per_unit, boq_master:boq_master!job_assignments_boq_item_id_fkey (quantity, price_per_unit, contractor_type_id)')
      .eq('plot_id', plotId)
      .order('created_at', { ascending: true }),
    supabase
      .from('billings')
      .select('billing_date, created_at, net_amount, billing_jobs (job_assignment_id, progress_percent)')
      .eq('plot_id', plotId)
      .in('status', ['approved', 'paid_out']),
    supabase
      .from('plot_phase_schedule')
      .select('contractor_type_id, planned_start_date, planned_end_date, contractor_types (name)')
      .eq('plot_id', plotId),
  ])

  const jobs = (jobsRes.data || []) as unknown as CurveJob[]
  if (jobs.length === 0) return EMPTY

  const jobValue = new Map<string, number>()
  const jobTypeId = new Map<string, number | null>()
  let totalBoqValue = 0
  for (const job of jobs) {
    const qty = job.boq_master?.quantity || 0
    const price = job.agreed_price_per_unit ?? job.boq_master?.price_per_unit ?? 0
    const value = qty * price
    jobValue.set(job.id, value)
    jobTypeId.set(job.id, job.boq_master?.contractor_type_id ?? null)
    totalBoqValue += value
  }

  const startDate = jobs[0].created_at
  const targetDate = (plotRes.data as { target_completion_date: string | null } | null)?.target_completion_date ?? null

  const phaseSchedule = (phaseScheduleRes.data || []) as unknown as CurvePhaseSchedule[]
  const phaseMilestones: PlotPhaseMilestone[] = phaseSchedule.map((phase) => {
    const phaseValue = jobs.reduce(
      (sum, job) => sum + (jobTypeId.get(job.id) === phase.contractor_type_id ? jobValue.get(job.id) || 0 : 0),
      0
    )
    return {
      contractorTypeId: phase.contractor_type_id,
      contractorTypeName: phase.contractor_types?.name || 'ไม่ระบุประเภทช่าง',
      plannedStart: phase.planned_start_date,
      plannedEnd: phase.planned_end_date,
      weight: totalBoqValue > 0 ? phaseValue / totalBoqValue : 0,
    }
  })

  const billings = (billingsRes.data || []) as unknown as CurveBilling[]
  const sortedBillings = [...billings].sort((a, b) => {
    const da = a.billing_date || a.created_at
    const db = b.billing_date || b.created_at
    return new Date(da).getTime() - new Date(db).getTime()
  })

  const jobProgress = new Map<string, number>()
  let cumulativeCost = 0
  const actualPoints: PlotProgressActualPoint[] = []

  for (const billing of sortedBillings) {
    cumulativeCost += billing.net_amount || 0
    for (const bj of billing.billing_jobs || []) {
      if (bj.job_assignment_id) jobProgress.set(bj.job_assignment_id, bj.progress_percent || 0)
    }
    const weighted =
      totalBoqValue > 0
        ? jobs.reduce((sum, job) => sum + ((jobProgress.get(job.id) || 0) / 100) * (jobValue.get(job.id) || 0), 0) / totalBoqValue * 100
        : 0
    actualPoints.push({
      date: billing.billing_date || billing.created_at,
      actualPercent: Math.round(weighted * 10) / 10,
      cumulativeCost,
    })
  }

  return { startDate, targetDate, totalBoqValue, actualPoints, phaseMilestones, today: new Date().toISOString() }
}
