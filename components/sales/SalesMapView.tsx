'use client'

import { useState } from 'react'
import { statusColorClasses } from '@/lib/sales/statusColors'
import type { SitePlanData } from '@/actions/sales-actions'
import { formatCurrency } from '@/lib/currency'
import SitePlanMap, { type SitePlanMarker } from '@/components/plots/SitePlanMap'

// Closing-pipeline statuses shown as filter buttons, in pipeline order.
const PANEL_STATUSES: { code: string; label: string; color: string }[] = [
  { code: 'reserved', label: 'จอง', color: 'amber' },
  { code: 'appraisal', label: 'ประเมิน', color: 'cyan' },
  { code: 'awaiting_inspection', label: 'ตรวจบ้าน', color: 'orange' },
  { code: 'awaiting_transfer', label: 'รอโอน', color: 'violet' },
]

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
  const [activeCode, setActiveCode] = useState<string | null>(null)

  const markers: SitePlanMarker[] = data.plots.map((plot) => ({
    id: plot.id,
    label: plot.name,
    colorClass: statusColorClasses(plot.statusColor).dot,
    meta: plot.statusLabel,
    summary: {
      status: (
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${statusColorClasses(plot.statusColor).chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${statusColorClasses(plot.statusColor).dot}`} />
          {plot.statusLabel}
        </span>
      ),
      lines: [
        { label: 'แบบบ้าน', value: plot.houseModelName || 'ไม่ระบุ' },
        { label: 'ลูกค้า', value: plot.customerName || 'ยังไม่มีลูกค้า' },
        {
          label: plot.salePrice != null ? 'ราคาขาย' : 'ราคาตั้ง',
          value: plot.salePrice != null ? `฿${formatCurrency(plot.salePrice)}` : plot.listPrice != null ? `฿${formatCurrency(plot.listPrice)}` : '—',
        },
      ],
      progressPercent: plot.progressPercent,
      progressLabel: `${plot.jobsDone}/${plot.jobsTotal} งาน · ${Math.round(plot.progressPercent)}%`,
    },
    mapX: plot.mapX,
    mapY: plot.mapY,
    dimmed:
      (visiblePlotIds.size > 0 && !visiblePlotIds.has(plot.id)) ||
      (activeCode !== null && plot.statusCode !== activeCode),
  }))

  const total = data.plots.length
  const transferred = data.plots.filter((p) => p.statusCode === 'transferred').length
  const percent = total > 0 ? Math.round((transferred / total) * 100) : 0
  const countOf = (code: string) => data.plots.filter((p) => p.statusCode === code).length

  const panel = (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold text-slate-700">โอนแล้ว</span>
          <span className="text-sm text-slate-600">
            <span className="text-lg font-bold text-emerald-600">{transferred}</span>/{total}
          </span>
        </div>
        <div
          className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={transferred}
        >
          <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-[220ms] ease-out" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-1 text-right text-[11px] text-slate-500">{percent}%</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {PANEL_STATUSES.map((s) => {
          const classes = statusColorClasses(s.color)
          const active = activeCode === s.code
          return (
            <button
              key={s.code}
              type="button"
              aria-pressed={active}
              onClick={() => setActiveCode(active ? null : s.code)}
              className={`flex min-h-[48px] items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium ring-1 transition ${classes.chip} ${
                active ? 'ring-2 ' + classes.ring + ' shadow' : 'hover:brightness-95'
              } ${activeCode && !active ? 'opacity-60' : ''}`}
            >
              <span>{s.label}</span>
              <span className="text-lg font-bold">{countOf(s.code)}</span>
            </button>
          )
        })}
      </div>
      {activeCode && (
        <button type="button" onClick={() => setActiveCode(null)} className="w-full text-center text-xs text-slate-500 underline">
          ล้างตัวกรอง
        </button>
      )}
    </div>
  )

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
      sidePanel={panel}
    />
  )
}
