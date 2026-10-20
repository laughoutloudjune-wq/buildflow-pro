import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Clock, HelpCircle } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
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

  const byName = (a: CostBoardRow, b: CostBoardRow) => a.plotName.localeCompare(b.plotName, 'th', { numeric: true })

  // "ต้องดู": one sentence per problem plot, worst first, then a single line
  // for plots with no weekly plan so they do not drown the real problems.
  const attention = canSeeLabor
    ? rows
        .flatMap((r) => {
          const out: { key: string; plot: CostBoardRow; text: string; level: 0 | 1 }[] = []
          if ((r.paidAhead || 0) > 0) out.push({ key: `${r.plotId}-paid`, plot: r, level: 0, text: `จ่ายเกินงานที่ทำได้ ${baht(r.paidAhead)} ใน ${r.paidAheadJobs} งาน` })
          if (r.health === 'behind' && r.expectedPercent != null && r.actualPercent != null)
            out.push({ key: `${r.plotId}-late`, plot: r, level: 1, text: `ช้ากว่าแผน ${Math.round(r.expectedPercent - r.actualPercent)}% (ทำได้ ${pct(r.actualPercent)} ควรได้ ${pct(r.expectedPercent)})` })
          return out
        })
        .sort((a, b) => a.level - b.level || byName(a.plot, b.plot))
    : []
  const noPlan = canSeeLabor ? rows.filter((r) => r.jobCount > 0 && !r.hasWeeklyPlan).length : 0

  // Plots grouped by batch; plots with no batch go last.
  const groups = new Map<string, CostBoardRow[]>()
  for (const r of rows) {
    const key = r.groupName || ''
    groups.set(key, [...(groups.get(key) || []), r])
  }
  const orderedGroups = [...groups.entries()]
    .map(([name, list]) => [name, [...list].sort(byName)] as const)
    .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[1][0].plotName.localeCompare(b[1][0].plotName, 'th', { numeric: true })))

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

      {canSeeLabor && (
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-800">ต้องดู {attention.length > 0 ? `(${attention.length})` : ''}</h3>
          {attention.length === 0 ? (
            <p className="text-sm text-emerald-700">ไม่มีแปลงที่จ่ายเกินงานหรือช้ากว่าแผน</p>
          ) : (
            <ul className="space-y-1.5">
              {attention.map((a) => (
                <li key={a.key} className="flex gap-2 text-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.level === 0 ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden />
                  <span>
                    <Link href={`/dashboard/projects/${projectId}/${a.plot.plotId}`} className="font-medium text-indigo-600 hover:underline">
                      {a.plot.plotName}
                    </Link>{' '}
                    <span className="text-slate-700">{a.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {noPlan > 0 && <p className="mt-2 text-xs text-slate-500">{noPlan} แปลงยังไม่มีแผนสัปดาห์ จึงเทียบกับแผนไม่ได้</p>}
        </Card>
      )}

      {orderedGroups.map(([groupName, list]) => (
        <Card key={groupName || '~none'} className="overflow-hidden p-0">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">
            {groupName || 'ไม่อยู่ในกลุ่ม'} <span className="font-normal text-slate-500">· {list.length} แปลง</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {list.map((r) => {
              const h = HEALTH[r.health]
              const actual = r.actualPercent == null ? null : Math.min(100, r.actualPercent)
              const expected = r.expectedPercent == null ? null : Math.min(100, r.expectedPercent)
              return (
                <li key={r.plotId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <Link href={`/dashboard/projects/${projectId}/${r.plotId}`} className="font-medium text-indigo-600 hover:underline">
                      {r.plotName}
                    </Link>
                    <div className="truncate text-xs text-slate-500">
                      {r.houseModel || '—'} · {r.jobCount} งาน
                    </div>
                  </div>
                  {canSeeLabor ? (
                    <div className="order-3 col-span-2 sm:order-none sm:col-span-1">
                      <div className="relative h-2.5 rounded-full bg-slate-100" aria-hidden>
                        {actual != null && <span className="absolute inset-y-0 left-0 rounded-full bg-indigo-500" style={{ width: `${actual}%` }} />}
                        {expected != null && <span className="absolute -inset-y-0.5 w-0.5 bg-slate-700" style={{ left: `${expected}%` }} />}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        ทำได้ {pct(r.actualPercent)} · ควรเสร็จ {pct(r.expectedPercent)} · จ่ายแล้ว {pct(r.paidPercent)}
                        {r.materialUsed ? ` · ใช้วัสดุ ${baht(r.materialUsed)}` : ''}
                        {r.extraWorkApproved ? ` · งานเพิ่ม ${baht(r.extraWorkApproved)}` : ''}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">ใช้วัสดุ {r.materialUsed ? baht(r.materialUsed) : '—'}</div>
                  )}
                  {canSeeLabor && (
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${h.tone}`}>
                      <h.icon className="h-3.5 w-3.5" aria-hidden /> {h.label}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      ))}
      <p className="text-xs text-slate-500">
        เส้นดำบนแถบ = ควรเสร็จ · แผนมาจากแผนงานรายสัปดาห์ (ถ้ามี) หรือวันที่เป้าหมายเสร็จของแปลง · ใช้วัสดุ = เบิกจากสโตร์ (การเบิกของกลุ่มแปลงแบ่งเท่ากันทุกแปลง) · จ่ายล่วงหน้าเป็นคำเตือน ไม่ได้ปิดกั้นการจ่ายเงิน
      </p>
    </div>
  )
}
