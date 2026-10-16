'use client'

import type { HistoryEntry } from '@/lib/procurement/documentHistory'
import { cn } from '@/lib/utils'

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** A timeline of history entries (see lib/procurement/documentHistory.ts). */
export default function DocumentHistoryList({ entries, emptyText = 'ยังไม่มีประวัติการเปลี่ยนแปลง' }: { entries: HistoryEntry[]; emptyText?: string }) {
  if (entries.length === 0) {
    return <p className="text-sm text-slate-500">{emptyText}</p>
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li
          key={entry.key}
          className={cn(
            'rounded-lg border-l-4 bg-slate-50 px-3 py-2',
            entry.tone === 'danger' ? 'border-rose-400' : 'border-slate-300'
          )}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className={cn('text-sm font-semibold', entry.tone === 'danger' ? 'text-rose-700' : 'text-slate-800')}>
              {entry.docLabel && <span className="mr-2 text-slate-500">{entry.docLabel}</span>}
              {entry.title}
            </p>
            <p className="text-xs text-slate-500">
              {entry.actor} · {formatWhen(entry.at)}
            </p>
          </div>
          {entry.reason && <p className="mt-1 text-sm text-slate-700">เหตุผล: {entry.reason}</p>}
          {entry.lines.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {entry.lines.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}
