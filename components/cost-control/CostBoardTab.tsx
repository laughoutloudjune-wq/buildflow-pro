import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Clock, HelpCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { TableFrame } from '@/components/ui/TableFrame'
import { formatCurrency } from '@/lib/currency'
import type { CostBoardRow, CostBoardTotals } from '@/actions/procurement/cost-board'
import type { ProgressState } from '@/lib/cost-control/progress'

const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n)}%`)
const baht = (n: number | null) => (n == null ? '—' : `฿${formatCurrency(n)}`)

const HEALTH: Record<ProgressState, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  paid_ahead: { label: 'จ่ายล่วงหน้า', tone: 'text-red-600', icon: AlertTriangle },
  behind: { label: 'ช้ากว่าแผน', tone: 'text-amber-600', icon: Clock },
  ok: { label: 'ปกติ', tone: 'text-emerald-600', icon: CheckCircle2 },
  unknown: { label: 'ยังไม่มีข้อมูล', tone: 'text-slate-400', icon: HelpCircle },
}

const HEALTH_ORDER: Record<ProgressState, number> = { paid_ahead: 0, behind: 1, unknown: 2, ok: 3 }

/**
 * Project cost board: one row per plot, three questions per row - how far
 * along (expected / actual / paid), what it costs in labor (paid vs the value
 * of work done), and what material has gone into it. Rows needing attention
 * come first. Each plot links to its own page for the detail behind a number.
 * Every figure comes from the same helpers as the plot page, so a row and its
 * detail never disagree.
 */
export default function CostBoardTab({
  projectId,
  rows,
  totals,
  canSeeLabor,
}: {
  projectId: string
  rows: CostBoardRow[]
  totals: CostBoardTotals
  canSeeLabor: boolean
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState title="ยังไม่มีแปลงในขอบเขตนี้" description="เลือกโครงการหรือกลุ่มแปลงอื่น" />
      </Card>
    )
  }

  const sorted = [...rows].sort((a, b) => {
    const diff = HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health]
    if (diff !== 0) return diff
    return a.plotName.localeCompare(b.plotName, 'th', { numeric: true })
  })

  const tiles = canSeeLabor
    ? [
        { label: 'จ่ายล่วงหน้าเกินงานที่ทำได้', value: baht(totals.paidAhead), sub: `${totals.paidAheadJobs} รายการงาน`, tone: (totals.paidAhead || 0) > 0 ? 'text-red-600' : 'text-slate-800' },
        { label: 'งานเพิ่ม (DC) อนุมัติแล้ว', value: baht(totals.extraWorkApproved), sub: totals.extraWorkPending ? `รออนุมัติ ${baht(totals.extraWorkPending)}` : undefined, tone: 'text-slate-800' },
        { label: 'ใช้วัสดุแล้ว (เบิกสโตร์)', value: baht(totals.materialUsed), sub: totals.materialNoPlot > 0 ? `ยังไม่ระบุแปลง ${baht(totals.materialNoPlot)}` : undefined, tone: 'text-slate-800' },
        { label: 'รอจ่ายเงิน (ทั้งโครงการ)', value: baht(totals.toPayOut), sub: `${totals.toPayOutCount} ใบเบิก`, tone: 'text-slate-800' },
      ]
    : [
        { label: 'ใช้วัสดุแล้ว (เบิกสโตร์)', value: baht(totals.materialUsed), sub: totals.materialNoPlot > 0 ? `ยังไม่ระบุแปลง ${baht(totals.materialNoPlot)}` : undefined, tone: 'text-slate-800' },
      ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="p-3">
            <div className="text-xs text-slate-500">{t.label}</div>
            <div className={`mt-1 text-lg font-bold ${t.tone}`}>{t.value}</div>
            {t.sub && <div className="text-[11px] text-slate-500">{t.sub}</div>}
          </Card>
        ))}
      </div>

      <TableFrame stickyHeader maxHeight="60vh">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs font-medium text-slate-500">
            <tr>
              <th className="px-3 py-2">แปลง</th>
              {canSeeLabor && (
                <th className="px-3 py-2" title="แผน = ควรเสร็จกี่ % ณ วันนี้ · จริง = งานที่ทำได้จริง · จ่าย = เงินที่จ่ายแล้วเทียบมูลค่างาน">
                  ความคืบหน้า แผน / จริง / จ่าย
                </th>
              )}
              {canSeeLabor && <th className="px-3 py-2 text-right">ค่าแรงจ่ายแล้ว / งานที่ทำได้</th>}
              {canSeeLabor && <th className="px-3 py-2 text-right">งานเพิ่ม (DC)</th>}
              <th className="px-3 py-2 text-right">ใช้วัสดุ</th>
              {canSeeLabor && <th className="px-3 py-2">สถานะ</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {sorted.map((r) => {
              const h = HEALTH[r.health]
              return (
                <tr key={r.plotId} className="align-top hover:bg-slate-50">
                  <td className="px-3 py-2.5">
                    <Link href={`/dashboard/projects/${projectId}/${r.plotId}`} className="font-medium text-indigo-600 hover:underline">
                      {r.plotName}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {r.houseModel || '—'} · {r.jobCount} งาน
                    </div>
                  </td>
                  {canSeeLabor && (
                    <td className="px-3 py-2.5 text-slate-700">
                      <span className="text-slate-500">{pct(r.expectedPercent)}</span> / <span className="font-medium text-blue-700">{pct(r.actualPercent)}</span> /{' '}
                      <span className="font-medium text-orange-600">{pct(r.paidPercent)}</span>
                    </td>
                  )}
                  {canSeeLabor && (
                    <td className="px-3 py-2.5 text-right">
                      {baht(r.paid)} / {baht(r.earned)}
                      {(r.paidAhead || 0) > 0 && <div className="text-[11px] font-medium text-red-600">จ่ายล่วงหน้า {baht(r.paidAhead)}</div>}
                    </td>
                  )}
                  {canSeeLabor && (
                    <td className="px-3 py-2.5 text-right">
                      {r.extraWorkApproved ? baht(r.extraWorkApproved) : '—'}
                      {r.extraWorkPending ? <div className="text-[11px] text-slate-500">รออนุมัติ {baht(r.extraWorkPending)}</div> : null}
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-right">{r.materialUsed ? baht(r.materialUsed) : '—'}</td>
                  {canSeeLabor && (
                    <td className={`px-3 py-2.5 ${h.tone}`}>
                      <span className="inline-flex items-center gap-1 text-xs font-medium">
                        <h.icon className="h-3.5 w-3.5" aria-hidden /> {h.label}
                      </span>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </TableFrame>
      <p className="text-xs text-slate-500">
        แผนจะแสดงเมื่อแปลงมีวันที่เป้าหมายเสร็จ · ใช้วัสดุ = เบิกจากสโตร์ (การเบิกของกลุ่มแปลงแบ่งเท่ากันทุกแปลง) · จ่ายล่วงหน้าเป็นคำเตือน ไม่ได้ปิดกั้นการจ่ายเงิน
      </p>
    </div>
  )
}
