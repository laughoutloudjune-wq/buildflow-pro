import { formatCurrency } from '@/lib/currency'
import type { ProgressState, ProgressSummary } from '@/lib/cost-control/progress'

const pct = (n: number | null) => (n == null ? null : Math.round(n))

function Row({ label, value, color, title }: { label: string; value: number | null; color: string; title: string }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-3" title={title}>
      <span className="text-sm text-slate-600">{label}</span>
      <span className="relative h-2.5 rounded-full bg-slate-100" aria-hidden>
        {value != null && <span className={`absolute inset-y-0 left-0 rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />}
      </span>
      <span className="text-right text-sm font-semibold tabular-nums text-slate-800">{value == null ? '—' : `${value}%`}</span>
    </div>
  )
}

/**
 * ควรเสร็จ / ทำได้จริง / จ่ายแล้ว for one plot, as three bars and one sentence.
 * The three answer different questions and are never blended: ควรเสร็จ is
 * where the weekly plan says the plot should be today, ทำได้จริง is work done
 * (weighted by job value), จ่ายแล้ว is money approved. Paid more than the work
 * done is a warning in the sentence, never a block.
 */
export default function PlotProgressSummary({
  summary,
  expectedPercent,
  health,
}: {
  summary: ProgressSummary
  expectedPercent: number | null
  health: ProgressState
}) {
  if (summary.contract <= 0) return null

  const expected = pct(expectedPercent)
  const actual = pct(summary.actualPercent)
  const paid = pct(summary.paidPercent)

  const parts: string[] = []
  if (actual == null) parts.push('ยังไม่มีข้อมูลความคืบหน้า')
  else {
    if (expected != null && actual + 5 < expected) parts.push(`ช้ากว่าแผน ${expected - actual}%`)
    if (summary.paidAhead > 0) parts.push(`จ่ายเกินงานที่ทำได้ ฿${formatCurrency(summary.paidAhead)} ใน ${summary.paidAheadJobs} งาน`)
    if (parts.length === 0) parts.push(expected == null ? 'ยังไม่มีแผนสัปดาห์ จึงยังไม่มีค่า "ควรเสร็จ"' : 'เป็นไปตามแผน')
  }
  const tone = health === 'paid_ahead' ? 'bg-red-50 text-red-900' : health === 'behind' ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'

  return (
    <div className="mb-3 space-y-2.5 rounded-lg border border-slate-200 bg-white p-4">
      <Row label="ควรเสร็จ" value={expected} color="bg-slate-400" title="ควรเสร็จกี่ % ณ วันนี้ ตามเป้าหมายในแผนงานรายสัปดาห์ (หรือวันที่เป้าหมายเสร็จของแปลง ถ้าไม่มีแผน)" />
      <Row label="ทำได้จริง" value={actual} color="bg-indigo-500" title="มูลค่างานที่ทำเสร็จจริง ถ่วงน้ำหนักตามมูลค่างานแต่ละรายการ" />
      <Row label="จ่ายแล้ว" value={paid} color="bg-orange-500" title="เงินที่อนุมัติจ่ายแล้ว เทียบกับมูลค่างานทั้งหมด" />
      <p className="text-xs text-slate-500">คิดตามมูลค่างาน: งานมูลค่าสูงนับมากกว่างานมูลค่าต่ำ · มูลค่างานทั้งแปลง ฿{formatCurrency(summary.contract)}</p>
      <p className={`rounded-md px-3 py-2 text-sm ${tone}`}>{parts.join(' · ')}</p>
    </div>
  )
}
