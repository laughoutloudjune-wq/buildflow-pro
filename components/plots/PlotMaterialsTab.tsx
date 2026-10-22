'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { getPlotMaterialsControl } from '@/actions/procurement/boq-control'
import QtyControlTab from '@/components/cost-control/QtyControlTab'

type Loaded = Awaited<ReturnType<typeof getPlotMaterialsControl>>

/**
 * The plot's materials tab is the same view as the cost-control materials
 * tab, scoped to this one plot (quantities only - no baht - so sales sees it
 * too; document detail is limited to roles that can see cost).
 */
export default function PlotMaterialsTab({ plotId }: { plotId: string }) {
  const [state, setState] = useState<{ plotId: string; data: Loaded | null; error: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    getPlotMaterialsControl(plotId)
      .then((data) => {
        if (!cancelled) setState({ plotId, data, error: null })
      })
      .catch((e) => {
        if (!cancelled) setState({ plotId, data: null, error: e instanceof Error ? e.message : 'โหลดวัสดุไม่สำเร็จ' })
      })
    return () => {
      cancelled = true
    }
  }, [plotId])

  if (!state || state.plotId !== plotId) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดวัสดุ...
      </Card>
    )
  }
  if (state.error || !state.data) {
    return <Card className="p-4 text-sm text-red-600">{state.error || 'โหลดวัสดุไม่สำเร็จ'}</Card>
  }
  return (
    <QtyControlTab
      scope={state.data.scope}
      rows={state.data.rows}
      plotId={plotId}
      canOpenDetail={state.data.canOpenDetail}
      showMoney={false}
    />
  )
}
