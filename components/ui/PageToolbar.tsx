'use client'

import * as React from 'react'
import { Search, X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { useDepartment } from '@/components/layout/DepartmentContext'

export type ActiveFilter = { label: string; onRemove?: () => void }

/**
 * The one toolbar above a result list: filter controls (children), an
 * optional search box, optional actions on the right, and a second line with
 * the result count, the active filters as removable chips, and a reset.
 * It wraps instead of overflowing on narrow widths.
 */
export function PageToolbar({
  children,
  search,
  actions,
  resultCount,
  activeFilters = [],
  onReset,
}: {
  children?: React.ReactNode
  search?: { value: string; onChange: (v: string) => void; placeholder?: string }
  actions?: React.ReactNode
  resultCount?: number
  activeFilters?: ActiveFilter[]
  onReset?: () => void
}) {
  const showSummary = resultCount != null || activeFilters.length > 0
  const { theme } = useDepartment()
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        {children}
        {search && (
          <div className="relative w-full min-w-[12rem] max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder ?? 'ค้นหา'}
              aria-label={search.placeholder ?? 'ค้นหา'}
              className="w-full pl-9"
            />
          </div>
        )}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {showSummary && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm text-slate-500">
          {resultCount != null && <span className="tabular-nums">{resultCount.toLocaleString('th-TH')} รายการ</span>}
          {activeFilters.map((f) => (
            <span key={f.label} className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1.5 text-xs font-medium ${theme.chip}`}>
              {f.label}
              {f.onRemove && (
                <button type="button" onClick={f.onRemove} aria-label={`เอา ${f.label} ออก`} className="rounded-full p-0.5 hover:bg-black/5">
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
          {activeFilters.length > 0 && onReset && (
            <button type="button" onClick={onReset} className={`text-xs font-medium hover:underline ${theme.text}`}>
              ล้างตัวกรอง
            </button>
          )}
        </div>
      )}
    </Card>
  )
}
