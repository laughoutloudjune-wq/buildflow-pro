'use client'

import { statusColorClasses } from '@/lib/sales/statusColors'
import type { SitePlanData } from '@/actions/sales-actions'
import SitePlanMap, { type SitePlanMarker } from '@/components/plots/SitePlanMap'

export default function SalesMapView({
  projectId,
  data,
  canEdit,
  visiblePlotIds,
}: {
  projectId: string
  data: SitePlanData
  canEdit: boolean
  visiblePlotIds: Set<string>
}) {
  const markers: SitePlanMarker[] = data.plots.map((plot) => ({
    id: plot.id,
    label: plot.name,
    colorClass: statusColorClasses(plot.statusColor).dot,
    meta: plot.statusLabel,
    mapX: plot.mapX,
    mapY: plot.mapY,
    dimmed: visiblePlotIds.size > 0 && !visiblePlotIds.has(plot.id),
  }))

  return (
    <SitePlanMap
      key={projectId}
      projectId={projectId}
      sitePlanUrl={data.sitePlanUrl}
      sitePlanWidth={data.sitePlanWidth}
      sitePlanHeight={data.sitePlanHeight}
      canEdit={canEdit}
      markers={markers}
      plotDetailTabs={['overview', 'sales', 'requests', 'history']}
    />
  )
}
