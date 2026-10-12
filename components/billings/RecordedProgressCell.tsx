import { AlertTriangle } from 'lucide-react'
import { checkClaimAgainstRecorded, PROGRESS_CLAIM_TOLERANCE, type RecordedProgress } from '@/lib/billing'
import { formatThaiDay } from '@/lib/weekly-plan'
import { todayInBangkok } from '@/lib/utils'

/**
 * Site progress recorded on the weekly plan, shown beside a billing claim.
 * Warns (never blocks) when the claim is well above what was recorded, when
 * nothing was recorded, or when the record is old.
 */
export default function RecordedProgressCell({ recorded, claimed }: { recorded: RecordedProgress | undefined; claimed: number | null }) {
  const check = checkClaimAgainstRecorded(claimed, recorded, todayInBangkok())
  return (
    <div className="text-right">
      {recorded ? (
        <>
          <p className="font-medium tabular-nums text-slate-800">{recorded.pct.toFixed(2)}%</p>
          <p className="text-[11px] text-slate-500">บันทึกเมื่อ {formatThaiDay(recorded.asOf)}</p>
        </>
      ) : (
        <p className="text-slate-400">-</p>
      )}
      {check.none && <Flag tone="amber">ยังไม่มีบันทึกความคืบหน้าหน้างาน</Flag>}
      {check.over && (
        <Flag tone="red">
          ขอเบิกสูงกว่างานจริง {check.gap.toFixed(1)} จุด (เกิน {PROGRESS_CLAIM_TOLERANCE})
        </Flag>
      )}
      {check.stale && <Flag tone="amber">ข้อมูลเก่า {check.ageDays} วัน</Flag>}
    </div>
  )
}

function Flag({ tone, children }: { tone: 'red' | 'amber'; children: React.ReactNode }) {
  return (
    <p className={`mt-1 inline-flex items-start gap-1 text-left text-[11px] font-medium ${tone === 'red' ? 'text-red-700' : 'text-amber-700'}`}>
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> <span>{children}</span>
    </p>
  )
}
