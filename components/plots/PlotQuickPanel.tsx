'use client'

import Link from 'next/link'
import { useDepartment } from '@/components/layout/DepartmentContext'
import type { ReactNode } from 'react'
import { ExternalLink, X } from 'lucide-react'

export type PlotQuickSummary = {
  /** Coloured status text/chip, already rendered by the caller. */
  status?: ReactNode
  lines: { label: string; value: string }[]
  /** 0-100; shown as a labelled bar when given. */
  progressPercent?: number
  progressLabel?: string
}

/**
 * The connected side panel for a selected plot: a short summary of the facts
 * people look for first, with the full detail one click away. Used next to
 * the site-plan map and beside the sales board's table and cards, so a plot
 * is read the same way wherever it is selected.
 */
export default function PlotQuickPanel({
  title,
  subtitle,
  summary,
  actions,
  detailHref,
  onClose,
}: {
  title: string
  subtitle?: string
  summary?: PlotQuickSummary
  actions?: ReactNode
  detailHref?: string
  onClose?: () => void
}) {
  const { theme } = useDepartment()
  const percent = summary?.progressPercent
  return (
    <aside aria-label={`สรุปแปลง ${title}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-slate-900">แปลง {title}</h3>
          {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดสรุปแปลง"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>

      {summary?.status && <div className="mt-2">{summary.status}</div>}

      {summary && summary.lines.length > 0 && (
        <dl className="mt-3 space-y-1.5 text-sm">
          {summary.lines.map((line) => (
            <div key={line.label} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-xs text-slate-500">{line.label}</dt>
              <dd className="min-w-0 truncate text-right font-medium text-slate-800">{line.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {percent != null && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] text-slate-500">
            <span>ก่อสร้าง</span>
            <span>{summary?.progressLabel ?? `${Math.round(percent)}%`}</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-label="ความคืบหน้าก่อสร้าง"
          >
            <div className={`h-full rounded-full ${theme.solid}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
          </div>
        </div>
      )}

      {(actions || detailHref) && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {actions}
          {detailHref && (
            <Link
              href={detailHref}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              เปิดเป็นหน้าเต็ม <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </div>
      )}
    </aside>
  )
}
