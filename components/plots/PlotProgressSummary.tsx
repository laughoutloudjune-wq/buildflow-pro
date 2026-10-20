import { AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import type { ProgressState, ProgressSummary } from '@/lib/cost-control/progress'

const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n)}%`)

const STATE_TEXT: Record<ProgressState, string> = {
  ok: 'ความคืบหน้าเป็นไปตามแผน',
  behind: 'งานช้ากว่าแผน',
  paid_ahead: 'จ่ายเงินล่วงหน้าเกินงานที่ทำได้',
  unknown: 'ยังไม่มีข้อมูลความคืบหน้า',
}

/**
 * Expected / Actual / Paid for one plot or batch, side by side. The three
 * answer different questions and are never blended: Expected = what the
 * schedule says should be done by today, Actual = work done (value-weighted),
 * Paid = money approved. Paid minus the value of work done is the "paid
 * ahead" warning - shown, never blocking.
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

  const tone =
    health === 'paid_ahead' ? 'border-red-200 bg-red-50' : health === 'behind' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
  const Icon = health === 'ok' ? CheckCircle2 : health === 'unknown' ? HelpCircle : AlertTriangle

  return (
    <div className={`mb-3 rounded-lg border p-3 ${tone}`}>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-xs text-slate-500" title="ควรเสร็จกี่ % ณ วันนี้ ตามวันเริ่มงานถึงวันที่เป้าหมายเสร็จของแปลง">
            แผน (ควรเสร็จ)
          </div>
          <div className="text-xl font-bold text-slate-700">{pct(expectedPercent)}</div>
          {expectedPercent == null && <div className="text-[11px] text-slate-400">ยังไม่ได้ตั้งวันที่เป้าหมายเสร็จ</div>}
        </div>
        <div>
          <div className="text-xs text-slate-500" title="มูลค่างานที่ทำเสร็จจริง ถ่วงน้ำหนักตามมูลค่างานแต่ละรายการ">
            ทำได้จริง
          </div>
          <div className="text-xl font-bold text-blue-700">{pct(summary.actualPercent)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500" title="เงินที่อนุมัติจ่ายแล้ว เทียบกับมูลค่างานทั้งหมด">
            จ่ายแล้ว
          </div>
          <div className="text-xl font-bold text-orange-600">{pct(summary.paidPercent)}</div>
        </div>
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-600">
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          {STATE_TEXT[health]}
          {summary.paidAhead > 0 && (
            <>
              {' '}
              · จ่ายล่วงหน้ารวม ฿{formatCurrency(summary.paidAhead)} ({summary.paidAheadJobs} รายการ)
            </>
          )}
        </span>
      </p>
    </div>
  )
}
