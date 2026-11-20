'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { previousPathname } from '@/lib/nav-history'
import { BackButton } from '@/components/ui/BackButton'
import { ChevronRight } from 'lucide-react'

export type Crumb = { label: string; href?: string }

/**
 * Compact context trail for deep routes (e.g. โครงการ › Arada › แปลง 103).
 * The last item is the current page and is not a link. Use it where the title
 * alone does not say where you are. It also shows a Back button: it returns to
 * the page the user came from (so lists keep their filters/search/page) and
 * falls back to the parent crumb when there is no history.
 */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  const router = useRouter()
  // The nearest linked ancestor is where Back falls back to when there is no in-app history.
  const parentHref = [...items.slice(0, -1)].reverse().find((c) => c.href)?.href
  return (
    <nav aria-label="เส้นทาง" className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      {parentHref && <BackButton fallbackHref={parentHref} className="mb-0 shrink-0 rounded-md border border-slate-200 bg-white px-2" />}
      <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
        {items.map((c, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${c.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />}
              {c.href && !last ? (
                <Link
                  href={c.href}
                  className="truncate hover:text-slate-900 hover:underline"
                  onClick={(e) => {
                    // The direct parent crumb behaves like Back when the user just came
                    // from it, so the list keeps its filters / search / page.
                    const isParent = i === items.length - 2
                    if (isParent && previousPathname() === (c.href ?? '').split(/[?#]/)[0]) {
                      e.preventDefault()
                      router.back()
                    }
                  }}
                >
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
