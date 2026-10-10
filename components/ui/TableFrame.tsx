import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Frame for a data table: border, radius, and a scroll region owned by the
 * table (never the whole page). Header, cell and row defaults come from
 * `.table-frame` in globals.css at zero specificity, so a table can still
 * override any of it with its own classes. Columns, sorting and row behaviour
 * stay in the feature screen.
 *
 * `stickyHeader` keeps the header visible while the rows scroll; pair it with
 * `maxHeight` (a CSS length such as "70vh").
 */
export function TableFrame({
  stickyHeader,
  maxHeight,
  className,
  children,
}: {
  stickyHeader?: boolean
  maxHeight?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-sticky={stickyHeader ? 'true' : undefined}
      className={cn(
        'table-frame overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
        className
      )}
    >
      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        {children}
      </div>
    </div>
  )
}
