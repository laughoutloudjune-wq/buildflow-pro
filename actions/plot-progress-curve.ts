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

export type PlotProgressCurve = {
  /** Earliest job_assignments.created_at for this plot - the planned
   * line's start point. Null when the plot has no jobs yet (nothing to
   * chart). */
  startDate: string | null
  /** plots.target_completion_date - the planned line's end point. Null
   * when nobody has set one yet. */
  targetDate: string | null
  /** Sum of quantity x effective price across every job - the 100% mark
   * for both the progress and cost curves (cost is shown as % of this, so
   * both series share one 0-100 axis). */
  totalBoqValue: number
  /** One point per approved/paid billing on this plot, chronological. */
  actualPoints: PlotProgressActualPoint[]
  /** Computed once here (a server action), not with `Date.now()` inside
   * the chart component's render - React's purity rule disallows calling
   * an impure clock function during render, memoized or not. */
  today: string
}

const EMPTY: PlotProgressCurve = { startDate: null, targetDate: null, totalBoqValue: 0, actualPoints: [], today: new Date().toISOString() }

type CurveJob = {
  id: string
  created_at: string
  agreed_price_per_unit: number | null
  boq_master: { quantity: number | null; price_per_unit: number | null } | null
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
 * row carries forward. The planned/expected line is NOT computed here; it's
 * cheap enough (a straight line from startDate to targetDate) to derive in
 * the chart component itself.
 */
export async function getPlotProgressCurve(plotId: string): Promise<PlotProgressCurve> {
  await requireModuleAccess('projects')
  const supabase = await createClient()

  const [plotRes, jobsRes, billingsRes] = await Promise.all([
    supabase.from('plots').select('target_completion_date').eq('id', plotId).maybeSingle(),
    supabase
      .from('job_assignments')
      .select('id, created_at, agreed_price_per_unit, boq_master:boq_master!job_assignments_boq_item_id_fkey (quantity, price_per_unit)')
      .eq('plot_id', plotId)
      .order('created_at', { ascending: true }),
    supabase
      .from('billings')
      .select('billing_date, created_at, net_amount, billing_jobs (job_assignment_id, progress_percent)')
      .eq('plot_id', plotId)
      .in('status', ['approved', 'paid_out']),
  ])

  const jobs = (jobsRes.data || []) as unknown as CurveJob[]
  if (jobs.length === 0) return EMPTY

  const jobValue = new Map<string, number>()
  let totalBoqValue = 0
  for (const job of jobs) {
    const qty = job.boq_master?.quantity || 0
    const price = job.agreed_price_per_unit ?? job.boq_master?.price_per_unit ?? 0
    const value = qty * price
    jobValue.set(job.id, value)
    totalBoqValue += value
  }

  const startDate = jobs[0].created_at
  const targetDate = (plotRes.data as { target_completion_date: string | null } | null)?.target_completion_date ?? null

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

  return { startDate, targetDate, totalBoqValue, actualPoints, today: new Date().toISOString() }
}
