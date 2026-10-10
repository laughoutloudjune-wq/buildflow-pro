import * as React from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

export type Crumb = { label: string; href?: string }

/**
 * Compact context trail for deep routes (e.g. โครงการ › Arada › แปลง 103).
 * The last item is the current page and is not a link. Use it where the title
 * alone does not say where you are, instead of a separate "back" button.
 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="เส้นทาง" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
        {items.map((c, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />}
              {c.href && !last ? (
                <Link href={c.href} className="truncate hover:text-slate-900 hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span className={`truncate ${last ? 'font-medium text-slate-700' : ''}`} aria-current={last ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
