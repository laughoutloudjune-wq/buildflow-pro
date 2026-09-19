'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { getPlotDetailBundle, type PlotDetailBundle } from '@/actions/plot-detail-bundle'
import PlotDetailPageClient, { type PlotDetailTab } from '@/app/dashboard/projects/[id]/[plotId]/PlotDetailPageClient'

/**
 * The full plot detail (all tabs) in a dialog, fetched on demand when a map
 * marker is clicked - a page navigation per plot was too slow for browsing
 * the map, and a slimmed-down summary just adds another click to get to the
 * same information. This shows everything PlotDetailPageClient shows,
 * nothing trimmed, without leaving the map.
 */
export default function PlotDetailModal({
  projectId,
  plotId,
  onClose,
  visibleTabs,
}: {
  projectId: string
  plotId: string | null
  onClose: () => void
  visibleTabs?: PlotDetailTab[]
}) {
  const [bundle, setBundle] = useState<PlotDetailBundle | null>(null)
  // Derived rather than tracked separately: whenever the fetched bundle
  // doesn't match the plot currently requested (a new marker was clicked,
  // or the modal just opened), we're still loading it.
  const isLoading = Boolean(plotId) && bundle?.plotId !== plotId

  useEffect(() => {
    if (!plotId) return
    let cancelled = false
    getPlotDetailBundle(projectId, plotId).then((res) => {
      if (!cancelled) setBundle(res)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, plotId])

  // Passed down as onRefresh so a save inside the modal (status change, deal
  // details, a payment) re-fetches this same plot instead of leaving the
  // modal showing pre-save data until it's closed and reopened -
  // router.refresh() wouldn't reach this, since the bundle is held in local
  // state here, not in the page behind the modal.
  function refetch() {
    if (!plotId) return
    getPlotDetailBundle(projectId, plotId).then(setBundle)
  }

  return (
    <Modal
      isOpen={Boolean(plotId)}
      onClose={onClose}
      title={bundle?.plot ? `แปลง ${bundle.plot.name}` : 'รายละเอียดแปลง'}
      panelClassName="max-w-5xl h-[90dvh]"
      bodyClassName="p-4 sm:p-6"
    >
      {isLoading || !bundle ? (
        <div className="flex h-full items-center justify-center text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <PlotDetailPageClient {...bundle} onClose={onClose} onRefresh={refetch} visibleTabs={visibleTabs} />
      )}
    </Modal>
  )
}
