import { statusColorClasses } from '@/lib/sales/statusColors'
import type { PlotProgressCurve } from '@/actions/plot-progress-curve'

type SaleMarker = { date: string; label: string }

const VIEW_W = 700
const VIEW_H = 260
const PAD_LEFT = 34
const PAD_RIGHT = 12
const PAD_TOP = 14
const PAD_BOTTOM = 40
const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM
const DAY_MS = 24 * 60 * 60 * 1000

function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })
}

/** Builds the timeline markers row from the deal's own key dates - no
 * separate query needed, these are already on saleDetail.sale. */
export function buildSaleMarkers(sale: {
  bookedAt: string | null
  contractAt: string | null
  inspectionAt: string | null
  transferAt: string | null
  deliveredAt: string | null
} | null): SaleMarker[] {
  if (!sale) return []
  const entries: [string | null, string][] = [
    [sale.bookedAt, 'จอง'],
    [sale.contractAt, 'ทำสัญญา'],
    [sale.inspectionAt, 'ตรวจบ้าน'],
    [sale.transferAt, 'โอนกรรมสิทธิ์'],
    [sale.deliveredAt, 'ส่งมอบ'],
  ]
  return entries
    .filter((e): e is [string, string] => Boolean(e[0]))
    .map(([date, label]) => ({ date, label }))
}

export default function PlotProgressCurveChart({
  curve,
  saleMarkers,
  statusLabel,
  statusColor,
}: {
  curve: PlotProgressCurve
  saleMarkers: SaleMarker[]
  statusLabel: string
  statusColor: string | null | undefined
}) {
  if (!curve.startDate) {
    return (
      <p className="py-10 text-center text-sm text-slate-400">
        ยังไม่มีรายการงาน (กด &quot;ดึง BOQ&quot;) จึงยังไม่มีข้อมูลสำหรับกราฟความคืบหน้า
      </p>
    )
  }

  const start = new Date(curve.startDate).getTime()
  const today = new Date(curve.today).getTime()
  const target = curve.targetDate ? new Date(curve.targetDate).getTime() : null
  const lastActual = curve.actualPoints.at(-1)
  const lastActualTime = lastActual ? new Date(lastActual.date).getTime() : start

  const candidates = [start, today, lastActualTime, ...(target ? [target] : [])]
  const domainEnd = Math.max(...candidates) + DAY_MS * 3
  const domainStart = Math.min(start, ...candidates)
  const span = Math.max(domainEnd - domainStart, DAY_MS)

  const x = (t: number) => PAD_LEFT + ((t - domainStart) / span) * PLOT_W
  const y = (pct: number) => PAD_TOP + (1 - Math.max(0, Math.min(100, pct)) / 100) * PLOT_H

  const plannedPath = target
    ? `M ${x(start)} ${y(0)} L ${x(target)} ${y(100)}` + (domainEnd > target ? ` L ${x(domainEnd)} ${y(100)}` : '')
    : null

  const actualPathPoints = [{ t: start, v: 0 }, ...curve.actualPoints.map((p) => ({ t: new Date(p.date).getTime(), v: p.actualPercent }))]
  const actualPath = actualPathPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.t)} ${y(p.v)}`).join(' ')

  const hasCost = curve.totalBoqValue > 0 && curve.actualPoints.length > 0
  const costPathPoints = [
    { t: start, v: 0 },
    ...curve.actualPoints.map((p) => ({ t: new Date(p.date).getTime(), v: (p.cumulativeCost / curve.totalBoqValue) * 100 })),
  ]
  const costPath = costPathPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.t)} ${y(p.v)}`).join(' ')
  const lastCostPercent = costPathPoints.at(-1)?.v ?? 0

  const c = statusColorClasses(statusColor)
  const gridLines = [0, 25, 50, 75, 100]

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-400" /> แผนงาน{!target && ' (ยังไม่กำหนด)'}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> ความคืบหน้าจริง</span>
          {hasCost && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500" /> ต้นทุนสะสม (% ของ BOQ){lastCostPercent > 100 && ` - เกินงบ ${Math.round(lastCostPercent - 100)}%`}</span>}
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${c.chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
          {statusLabel}
        </span>
      </div>

      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="w-full" role="img" aria-label="กราฟความคืบหน้าแปลง">
        {gridLines.map((g) => (
          <g key={g}>
            <line x1={PAD_LEFT} y1={y(g)} x2={VIEW_W - PAD_RIGHT} y2={y(g)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={PAD_LEFT - 6} y={y(g) + 3} textAnchor="end" fontSize={9} fill="#94a3b8">{g}%</text>
          </g>
        ))}

        {plannedPath && <path d={plannedPath} fill="none" stroke="#818cf8" strokeWidth={2} strokeDasharray="5 4" />}
        {hasCost && <path d={costPath} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="2 3" />}
        <path d={actualPath} fill="none" stroke="#10b981" strokeWidth={2.5} />
        {lastActual && (
          <circle cx={x(lastActualTime)} cy={y(lastActual.actualPercent)} r={3.5} fill="#10b981" />
        )}

        {/* วันนี้ */}
        <line x1={x(today)} y1={PAD_TOP} x2={x(today)} y2={PAD_TOP + PLOT_H} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 3" />
        <text x={x(today)} y={PAD_TOP - 3} textAnchor="middle" fontSize={9} fill="#94a3b8">วันนี้</text>

        {/* หมุดเหตุการณ์การขาย */}
        {saleMarkers.map((m) => {
          const t = new Date(m.date).getTime()
          if (t < domainStart || t > domainEnd) return null
          return (
            <g key={`${m.date}-${m.label}`}>
              <circle cx={x(t)} cy={PAD_TOP + PLOT_H} r={2.5} fill="#6366f1" />
              <text x={x(t)} y={PAD_TOP + PLOT_H + 12} textAnchor="middle" fontSize={8} fill="#64748b">{m.label}</text>
            </g>
          )
        })}

        {/* แกนเวลา: เริ่ม / เป้าหมาย / ล่าสุด */}
        <text x={x(start)} y={VIEW_H - 4} textAnchor="start" fontSize={9} fill="#94a3b8">{fmtShort(curve.startDate)}</text>
        {target && (
          <text x={x(target)} y={VIEW_H - 4} textAnchor="middle" fontSize={9} fill="#818cf8">
            เป้าหมาย {fmtShort(curve.targetDate!)}
          </text>
        )}
      </svg>

      {lastActual && (
        <p className="mt-1 text-right text-xs text-slate-400">
          ล่าสุด {fmtShort(lastActual.date)}: ความคืบหน้า {lastActual.actualPercent}%
        </p>
      )}
    </div>
  )
}
