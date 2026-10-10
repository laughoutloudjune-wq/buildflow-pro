import * as React from 'react'
import { Inbox, SearchX, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * What is absent and what to do next. Use `variant="no-results"` when a
 * search or filter removed everything, and `empty` when there is simply
 * nothing yet; the wording and next action differ.
 */
export function EmptyState({
  variant = 'empty',
  icon,
  title,
  description,
  action,
  className,
}: {
  variant?: 'empty' | 'no-results'
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  const Icon = icon ?? (variant === 'no-results' ? SearchX : Inbox)
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-12 text-center', className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
