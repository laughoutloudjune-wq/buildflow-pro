'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { canGoBackInApp } from '@/lib/nav-history'

/**
 * Goes back to the page the user came from, using browser history so the list
 * comes back with the same filters / search / sort / page (those live in the
 * URL, see useUrlState). If there is no in-app page behind (opened from a
 * bookmark, a new tab, after a reload) it goes to `fallbackHref` instead.
 *
 * Put it at the top of every page that is reached from a list.
 */
export function BackButton({
  fallbackHref,
  label = 'กลับ',
  className,
}: {
  fallbackHref: string
  label?: React.ReactNode
  className?: string
}) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => (canGoBackInApp() ? router.back() : router.push(fallbackHref))}
      className={cn(
        'mb-2 inline-flex w-fit items-center gap-1.5 rounded-md py-1 pr-2 text-sm font-medium text-slate-600 transition hover:text-indigo-600',
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {label}
    </button>
  )
}
