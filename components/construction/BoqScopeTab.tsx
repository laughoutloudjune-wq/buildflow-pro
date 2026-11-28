'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getBoqControl } from '@/actions/procurement/boq-control'
import QtyControlTab from '@/components/cost-control/QtyControlTab'
import type { ControlScope } from '@/lib/procurement/boqControl'

type Loaded = Awaited<ReturnType<typeof getBoqControl>>

/**
 * วัสดุ BOQ for any scope - a whole project, a batch, a few plots or one plot.
 * It is today's คุมปริมาณวัสดุ view unchanged (รอสั่ง, รับแล้ว, plan sources,
 * PO / withdrawal documents, ซื้อแต่ไม่มีใน BOQ, unit-conversion warnings, Excel
 * export, over-BOQ reasons); this wrapper only loads it for the scope it is
 * given, so the project board, the batch hub and the plot hub all show the
 * same table. The "ยังไม่ระบุแปลง" bucket and the outside-BOQ POs are project-level, so a single plot does not show them.
 */
export default function BoqScopeTab({ scope }: { scope: ControlScope }) {
  const key = JSON.stringify([scope.projectId, scope.plotGroupId || null, scope.plotIds || []])
  const [state, setState] = useState<{ key: string; data: Loaded | null; error: string | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    getBoqControl(scope)
      .then((data) => !cancelled && setState({ key, data, error: null }))
      .catch((e) => !cancelled && setState({ key, data: null, error: e instanceof Error ? e.message : 'โหลดวัสดุไม่สำเร็จ' }))
    return () => {
      cancelled = true
    }
    // The key captures every field of the scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!state || state.key !== key) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลดวัสดุ...
      </p>
    )
  }
  if (state.error || !state.data) return <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{state.error || 'โหลดวัสดุไม่สำเร็จ'}</p>

  const singlePlot = scope.plotIds && scope.plotIds.length === 1 ? scope.plotIds[0] : undefined
  return (
    <QtyControlTab
      key={key}
      scope={scope}
      rows={state.data.rows}
      unassigned={singlePlot ? [] : state.data.unassigned}
      outsideBoq={singlePlot ? [] : state.data.outsideBoq}
      plotId={singlePlot}
    />
  )
}
