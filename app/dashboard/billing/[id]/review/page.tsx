import { getBillingById, getJobProgressHistory } from '@/actions/billing-actions'
import { getOrganizationSettings } from '@/actions/settings-actions'
import { getSignatureSlots } from '@/actions/signature-slots-actions'
import type { BillingAdjustmentForm, ProgressHistoryItem } from '@/lib/types/billing'
import ReviewBillingPageClient from './ReviewBillingPageClient'

type BillingData = Awaited<ReturnType<typeof getBillingById>>
type Job = NonNullable<NonNullable<BillingData>['billing_jobs']>[number]
type Adjustment = BillingAdjustmentForm & { id?: string }

export default async function ReviewBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let billing: BillingData = null
  let settings: Awaited<ReturnType<typeof getOrganizationSettings>> = null
  let signatureSlots: Awaited<ReturnType<typeof getSignatureSlots>> = []
  let jobs: Job[] = []
  let adjustments: Adjustment[] = []
  let billingDate = new Date().toISOString().split('T')[0]
  let whtPercent = 0
  let retentionPercent = 0
  let progressHistoryByJob: Record<string, ProgressHistoryItem[]> = {}
  let error: string | null = null

  try {
    const [billingData, settingsData, slotsData] = await Promise.all([
      getBillingById(id),
      getOrganizationSettings(),
      getSignatureSlots('billing'),
    ])

    settings = settingsData
    signatureSlots = slotsData

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
      initialSettings={settings}
      initialSignatureSlots={signatureSlots}
      initialJobs={jobs}
      initialAdjustments={adjustments}
      initialBillingDate={billingDate}
      initialWhtPercent={whtPercent}
      initialRetentionPercent={retentionPercent}
      initialProgressHistoryByJob={progressHistoryByJob}
      initialError={error}
    />
  )
}
