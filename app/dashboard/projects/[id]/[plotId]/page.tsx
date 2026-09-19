import { getPlotDetailBundle } from '@/actions/plot-detail-bundle'
import PlotDetailPageClient from './PlotDetailPageClient'

/**
 * Plot detail, both departments (Phase 5, SALES_MODULE_PLAN.md §8.3). All
 * the fetching, role resolution and cost-stripping lives in
 * getPlotDetailBundle() now - shared with the map's quick-view modal
 * (components/plots/PlotDetailModal.tsx) so there's exactly one place that
 * decides canSeeCost, not two copies that could drift.
 */
export default async function PlotDetailPage({ params }: { params: Promise<{ id: string; plotId: string }> }) {
  const { id: projectId, plotId } = await params
  const bundle = await getPlotDetailBundle(projectId, plotId)

  return <PlotDetailPageClient {...bundle} />
}
