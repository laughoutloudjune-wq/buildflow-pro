'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import BillingModal from '@/components/billings/BillingModal'
import EmbeddedFrameModal from '@/components/construction/EmbeddedFrameModal'
import JobIssueModal from '@/components/construction/JobIssueModal'
import { useHubModal } from '@/components/construction/useHubModal'

/**
 * Opens the focused popup for one job (what is wrong and the fix beside it).
 * A bill opened from it shows in the review popup when the viewer may approve,
 * else the read-only bill; the plot hub opens as a popup too. All stay over the
 * page, so closing returns to the same filters.
 */
export function useJobIssue({ projectId, canEdit, canReview }: { projectId: string; canEdit: boolean; canReview: boolean }) {
  const router = useRouter()
  const [jobId, setJobId] = useState<string | null>(null)
  const [queue, setQueue] = useState<{ jobId: string; name: string }[] | undefined>(undefined)
  const [viewId, setViewId] = useState<string | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const plotHub = useHubModal()

  const node = (
    <>
      {jobId && (
        <JobIssueModal
          jobId={jobId}
          projectId={projectId}
          canEdit={canEdit}
          queue={queue}
          onSwitch={setJobId}
          onOpenBill={(id) => (canReview ? setReviewId(id) : setViewId(id))}
          onOpenPlot={(plotId, plotName) => plotHub.open(`/dashboard/projects/${projectId}/${plotId}`, `แปลง ${plotName}`)}
          onChanged={() => router.refresh()}
          onClose={() => { setJobId(null); setQueue(undefined) }}
        />
      )}
      <BillingModal billingId={viewId} onClose={() => setViewId(null)} onDeleted={() => { setViewId(null); router.refresh() }} />
      <EmbeddedFrameModal
        isOpen={!!reviewId}
        title="ตรวจใบเบิก"
        src={reviewId ? `/dashboard/billing/${reviewId}/review` : ''}
        stayWhile={(p) => /^\/dashboard\/billing\/[^/]+\/review/.test(p)}
        onClose={() => setReviewId(null)}
        onDone={() => {
          setReviewId(null)
          router.refresh()
        }}
      />
      {plotHub.node}
    </>
  )

  return {
    open: (id: string, others?: { jobId: string; name: string }[]) => {
      setQueue(others)
      setJobId(id)
    },
    node,
  }
}
