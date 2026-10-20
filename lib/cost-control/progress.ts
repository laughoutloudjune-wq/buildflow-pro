/**
 * Progress and earned-value math for the cost-control views - pure, no I/O.
 *
 * Three numbers are kept apart on purpose:
 *   Actual   - how much of the work is done (value-weighted % of contract)
 *   Paid     - how much money has been approved for payment
 *   Expected - how much should be done by today according to the schedule
 * Earned = progress % x contract value. Paid minus Earned is "paid ahead of
 * work" - a warning only, never a block (a deposit may be deliberate).
 */

const DAY_MS = 24 * 60 * 60 * 1000

export type ProgressJob = {
  /** Contract value: quantity x effective price. */
  value: number
  /** Latest reported progress 0-100; null when nobody has reported any. */
  progressPercent: number | null
  /** Approved payments so far. */
  paid: number
}

export type ProgressSummary = {
  contract: number
  paid: number
  earned: number
  /** Value-weighted % of the contract that is done; null when no value. */
  actualPercent: number | null
  /** paid / contract as a %; null when no value. */
  paidPercent: number | null
  /** max(0, paid - earned) summed per job, so one job paid ahead is not
   * hidden by another that is behind on payment. */
  paidAhead: number
  /** Jobs that are paid ahead by more than the tolerance. */
  paidAheadJobs: number
}

/** Smaller than this (baht) is rounding noise, not "paid ahead". */
export const PAID_AHEAD_TOLERANCE = 1

export function earnedForJob(job: ProgressJob): number {
  const pct = Math.min(100, Math.max(0, job.progressPercent ?? 0))
  return (pct / 100) * job.value
}

export function paidAheadForJob(job: ProgressJob): number {
  const ahead = job.paid - earnedForJob(job)
  return ahead > PAID_AHEAD_TOLERANCE ? ahead : 0
}

export function summarizeProgress(jobs: ProgressJob[]): ProgressSummary {
  let contract = 0
  let paid = 0
  let earned = 0
  let paidAhead = 0
  let paidAheadJobs = 0
  for (const job of jobs) {
    contract += job.value
    paid += job.paid
    earned += earnedForJob(job)
    const ahead = paidAheadForJob(job)
    if (ahead > 0) {
      paidAhead += ahead
      paidAheadJobs += 1
    }
  }
  return {
    contract,
    paid,
    earned,
    actualPercent: contract > 0 ? (earned / contract) * 100 : null,
    paidPercent: contract > 0 ? (paid / contract) * 100 : null,
    paidAhead,
    paidAheadJobs,
  }
}

export type ExpectedPhase = { plannedStart: string; plannedEnd: string; weight: number }

/**
 * Planned % complete on `today`. With per-phase windows it is the sum of
 * value-weighted ramps (the same rule the plot progress chart draws);
 * otherwise a straight ramp from `startDate` to `targetDate`. Null when
 * neither a schedule nor a target date exists - never a made-up 0.
 */
export function expectedPercentAt(input: {
  today: string
  startDate: string | null
  targetDate: string | null
  phases: ExpectedPhase[]
}): number | null {
  const t = new Date(input.today).getTime()
  if (!Number.isFinite(t)) return null

  if (input.phases.length > 0) {
    let sum = 0
    for (const p of input.phases) {
      const start = new Date(p.plannedStart).getTime()
      const end = new Date(p.plannedEnd).getTime()
      if (!Number.isFinite(start) || !Number.isFinite(end) || t <= start) continue
      const frac = end > start ? Math.min(1, (t - start) / (end - start)) : 1
      sum += frac * p.weight
    }
    return Math.max(0, Math.min(100, sum * 100))
  }

  if (!input.startDate || !input.targetDate) return null
  const start = new Date(input.startDate).getTime()
  const end = new Date(input.targetDate).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return Math.max(0, Math.min(100, ((t - start) / (end - start)) * 100))
}

export type ProgressState = 'ok' | 'behind' | 'paid_ahead' | 'unknown'

/**
 * One word for a plot's progress: paid ahead of work wins (it is money),
 * then behind schedule (actual trails expected by 5+ points), otherwise ok.
 * 'unknown' when there is no progress data to judge.
 */
export function progressState(summary: ProgressSummary, expectedPercent: number | null): ProgressState {
  if (summary.contract <= 0 || summary.actualPercent == null) return 'unknown'
  if (summary.paidAhead > PAID_AHEAD_TOLERANCE) return 'paid_ahead'
  if (expectedPercent != null && summary.actualPercent + 5 < expectedPercent) return 'behind'
  return 'ok'
}

/** Whole days between two ISO dates (b - a); negative when b is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / DAY_MS)
}

/**
 * The newest of two progress readings (billing vs weekly-plan actual).
 * Billing is the paid-up-to figure; the weekly-plan figure is what the
 * foreman reported. Whichever is newer wins; a tie goes to billing because
 * it is the audited one.
 */
export function pickLatestProgress(
  billing: { percent: number; asOf: string } | null,
  weekly: { percent: number; asOf: string } | null
): { percent: number; source: 'billing' | 'weekly' } | null {
  if (billing && weekly) {
    return new Date(weekly.asOf).getTime() > new Date(billing.asOf).getTime()
      ? { percent: weekly.percent, source: 'weekly' }
      : { percent: billing.percent, source: 'billing' }
  }
  if (billing) return { percent: billing.percent, source: 'billing' }
  if (weekly) return { percent: weekly.percent, source: 'weekly' }
  return null
}
