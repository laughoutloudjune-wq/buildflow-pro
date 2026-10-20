import type { createClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/actions/_shared/fetch-all-rows'
import { addDaysStr, latestPct } from '@/lib/weekly-plan'
import { pickLatestProgress } from '@/lib/cost-control/progress'

type Supabase = Awaited<ReturnType<typeof createClient>>

export type JobProgress = {
  percent: number
  /** 'billing' = the latest approved billing; 'weekly' = the foreman's weekly-plan actual, when newer. */
  source: 'billing' | 'weekly'
}

const CHUNK = 50

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function clampPercent(n: number): number {
  return Math.max(0, Math.min(100, Number(n) || 0))
}

type BillingJobRow = {
  job_assignment_id: string | null
  progress_percent: number | null
  billings: { billing_date: string | null; created_at: string } | { billing_date: string | null; created_at: string }[] | null
}

type WeeklyRow = { job_assignment_id: string | null; week_start: string; actual_pct: (number | null)[] | null }

/**
 * The most recent progress reading per job: the latest approved progress
 * billing, or the foreman's weekly-plan actual when that is newer. One
 * definition shared by the plot cost view and the project board, so the two
 * can never disagree about how far along a job is.
 *
 * Scope with `jobIds` (a plot's jobs) or `projectId` (every job in a
 * project). Jobs nobody has reported on are simply absent from the map.
 */
export async function fetchLatestJobProgress(
  supabase: Supabase,
  scope: { jobIds: string[] } | { projectId: string }
): Promise<Map<string, JobProgress>> {
  const billingByJob = new Map<string, { percent: number; asOf: string }>()
  const weeklyByJob = new Map<string, { percent: number; asOf: string }>()

  const billingSelect = 'job_assignment_id, progress_percent, billings!inner (billing_date, created_at, status, type, project_id)'
  let billingRows: BillingJobRow[] = []
  if ('jobIds' in scope) {
    for (const ids of chunk(scope.jobIds, CHUNK)) {
      const { data, error } = await supabase
        .from('billing_jobs')
        .select(billingSelect)
        .in('job_assignment_id', ids)
        .in('billings.status', ['approved', 'paid_out'])
        .eq('billings.type', 'progress')
      if (error) throw new Error(error.message)
      billingRows.push(...((data || []) as unknown as BillingJobRow[]))
    }
  } else {
    billingRows = await fetchAllRows<BillingJobRow>(
      (from, to) =>
        supabase
          .from('billing_jobs')
          .select(billingSelect)
          .eq('billings.project_id', scope.projectId)
          .in('billings.status', ['approved', 'paid_out'])
          .eq('billings.type', 'progress')
          .range(from, to) as unknown as PromiseLike<{ data: BillingJobRow[] | null; error: { message: string } | null }>
    )
  }
  for (const row of billingRows) {
    if (!row.job_assignment_id || row.progress_percent == null) continue
    const billing = Array.isArray(row.billings) ? row.billings[0] : row.billings
    if (!billing) continue
    const asOf = billing.billing_date || billing.created_at
    const prev = billingByJob.get(row.job_assignment_id)
    if (!prev || new Date(asOf).getTime() >= new Date(prev.asOf).getTime()) {
      billingByJob.set(row.job_assignment_id, { percent: clampPercent(row.progress_percent), asOf })
    }
  }

  // Weekly-plan actuals are a soft source: the roles that can read them are
  // narrower than the cost-control roles, so any failure just means "no
  // weekly reading" rather than breaking the page.
  try {
    let weeklyRows: WeeklyRow[] = []
    if ('jobIds' in scope) {
      for (const ids of chunk(scope.jobIds, CHUNK)) {
        const { data, error } = await supabase
          .from('weekly_plan_items')
          .select('job_assignment_id, week_start, actual_pct')
          .in('job_assignment_id', ids)
        if (error) throw new Error(error.message)
        weeklyRows.push(...((data || []) as unknown as WeeklyRow[]))
      }
    } else {
      weeklyRows = await fetchAllRows<WeeklyRow>(
        (from, to) =>
          supabase
            .from('weekly_plan_items')
            .select('job_assignment_id, week_start, actual_pct')
            .eq('project_id', scope.projectId)
            .not('job_assignment_id', 'is', null)
            .range(from, to) as unknown as PromiseLike<{ data: WeeklyRow[] | null; error: { message: string } | null }>
      )
    }
    for (const row of weeklyRows) {
      if (!row.job_assignment_id) continue
      const latest = latestPct((row.actual_pct || []).map((v) => (v == null ? null : Number(v))))
      if (!latest) continue
      const asOf = addDaysStr(row.week_start, latest.day)
      const prev = weeklyByJob.get(row.job_assignment_id)
      if (!prev || new Date(asOf).getTime() >= new Date(prev.asOf).getTime()) {
        weeklyByJob.set(row.job_assignment_id, { percent: clampPercent(latest.value), asOf })
      }
    }
  } catch (error) {
    console.error('job progress: weekly actuals unavailable', error)
  }

  const result = new Map<string, JobProgress>()
  for (const id of new Set([...billingByJob.keys(), ...weeklyByJob.keys()])) {
    const picked = pickLatestProgress(billingByJob.get(id) ?? null, weeklyByJob.get(id) ?? null)
    if (picked) result.set(id, picked)
  }
  return result
}
