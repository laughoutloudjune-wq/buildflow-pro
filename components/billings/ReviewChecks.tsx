import { Card } from '@/components/ui/Card'

export type ReviewCheck = { tone: 'bad' | 'late' | 'info' | 'ok'; text: string }

const DOT: Record<ReviewCheck['tone'], string> = {
  bad: 'bg-red-500',
  late: 'bg-amber-500',
  info: 'bg-slate-400',
  ok: 'bg-emerald-500',
}

/** "ผลการตรวจ": one sentence per check with a coloured dot. Warnings only - nothing here blocks approval. */
export default function ReviewChecks({ checks, loading }: { checks: ReviewCheck[]; loading?: boolean }) {
  const flagged = checks.filter((c) => c.tone === 'bad' || c.tone === 'late').length
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
        <h2 className="text-base font-semibold text-slate-900">ผลการตรวจ</h2>
        <span className={`text-xs ${flagged > 0 ? 'font-medium text-amber-700' : 'text-slate-500'}`}>
          {loading ? 'กำลังตรวจ...' : flagged > 0 ? `${flagged} เรื่องควรดู` : 'ไม่มีเรื่องต้องดู'}
        </span>
      </div>
      <ul>
        {checks.map((c, i) => (
          <li key={i} className="flex items-start gap-2.5 border-b border-slate-100 py-2 text-sm text-slate-700 last:border-0">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[c.tone]}`} aria-hidden />
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
