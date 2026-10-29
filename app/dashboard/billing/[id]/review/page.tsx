import { getBillingById, getJobProgressHistory, getPendingBillingQueue } from '@/actions/billing-actions'
import { getDashboardSession } from '@/lib/auth/route-access'
import type { BillingAdjustmentForm, ProgressHistoryItem } from '@/lib/types/billing'
import { todayInBangkok } from '@/lib/utils'
import ReviewBillingPageClient from './ReviewBillingPageClient'

type BillingData = Awaited<ReturnType<typeof getBillingById>>
type Job = NonNullable<NonNullable<BillingData>['billing_jobs']>[number]
type Adjustment = BillingAdjustmentForm & { id?: string }

export default async function ReviewBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ done?: string }>
}) {
  const [{ id }, { done }] = await Promise.all([params, searchParams])

  let billing: BillingData = null
  let jobs: Job[] = []
  let adjustments: Adjustment[] = []
  let billingDate = todayInBangkok()
  let whtPercent = 0
  let retentionPercent = 0
  let progressHistoryByJob: Record<string, ProgressHistoryItem[]> = {}
  let error: string | null = null

  // billing_approve/reject/undo_approve all refuse anyone but PM/Admin at
  // the database layer already (W-02) - this just keeps accountant (who
  // still reads billing for the payment cycle) from seeing buttons that
  // would only come back with a Thai refusal.
  const { role } = await getDashboardSession()
  const canApprove = role === 'pm' || role === 'admin'

  // The other bills waiting for review, so approving or rejecting this one
  // can go straight to the next instead of back to the list.
  let queue: string[] = []

  try {
    const [billingData, pendingIds] = await Promise.all([getBillingById(id), getPendingBillingQueue()])
    queue = pendingIds

    if (billingData) {
      billing = billingData
      jobs = Array.isArray(billingData.billing_jobs) ? billingData.billing_jobs : []
      adjustments = Array.isArray(billingData.billing_adjustments)
        ? billingData.billing_adjustments.map((adj: Adjustment) => ({
            ...adj,
            plot_name: adj.plot_name || '',
          }))
        : []
      whtPercent = billingData.wht_percent ?? 0
      retentionPercent = billingData.retention_percent ?? 0
      if (billingData.billing_date) {
        billingDate = new Date(billingData.billing_date).toISOString().split('T')[0]
      }

      const ids = Array.from(
        new Set(
          jobs
            .map((job) => job.job_assignments?.id)
            .filter((jobId): jobId is string => Boolean(jobId))
        )
      )
      if (ids.length > 0) {
        progressHistoryByJob = (await getJobProgressHistory(ids)) || {}
      }
    } else {
      error = 'ไม่พบใบเบิกนี้'
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load billing'
  }

  return (
    <ReviewBillingPageClient
      id={id}
      initialBilling={billing}
      initialJobs={jobs}
      initialAdjustments={adjustments}
      initialBillingDate={billingDate}
      initialWhtPercent={whtPercent}
      initialRetentionPercent={retentionPercent}
      initialProgressHistoryByJob={progressHistoryByJob}
      initialError={error}
      canApprove={canApprove}
      nextPendingId={nextPendingId(queue, id)}
      pendingAfterThis={queue.filter((q) => q !== id).length}
      previousOutcome={done === 'approved' || done === 'rejected' ? done : null}
    />
  )
}

/** The bill after this one in list order, wrapping to the top. */
function nextPendingId(queue: string[], currentId: string): string | null {
  const at = queue.indexOf(currentId)
  const rest = at === -1 ? queue : [...queue.slice(at + 1), ...queue.slice(0, at)]
  return rest[0] ?? null
}
