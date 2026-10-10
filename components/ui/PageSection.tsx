'use client'

import * as React from 'react'
import { useDepartment } from '@/components/layout/DepartmentContext'
import { cn } from '@/lib/utils'

/** A titled block on a long page: section title (18px), optional supporting
 * text and an action slot, with predictable spacing. Prefer this to wrapping
 * every block in its own card. */
export function PageSection({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const { theme } = useDepartment()
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden className={cn('mt-1 h-5 w-1 shrink-0 rounded-full', theme.solid)} />
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
