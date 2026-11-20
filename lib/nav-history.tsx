'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Tiny in-app navigation stack (pathnames only). It lets BackButton and the
 * breadcrumb know whether the page the user came from is a page of this app,
 * so "back" can use real browser history (which restores the list's URL, and
 * with it its filters / search / sort / page) instead of a hard-coded link.
 *
 * Query-only changes (list filters use history.replaceState) never add an
 * entry, because the stack follows pathname changes only.
 */
let stack: string[] = []
let popped = false

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    popped = true
  })
}

export function NavHistoryTracker() {
  const pathname = usePathname()
  useEffect(() => {
    if (stack[stack.length - 1] === pathname) return
    if (popped) {
      popped = false
      const i = stack.lastIndexOf(pathname)
      stack = i >= 0 ? stack.slice(0, i + 1) : [pathname]
    } else {
      stack = [...stack, pathname].slice(-50)
    }
  }, [pathname])
  return null
}

/** Pathname of the in-app page the user came from, or null (fresh load / new tab). */
export function previousPathname(): string | null {
  return stack.length >= 2 ? stack[stack.length - 2] : null
}

export function canGoBackInApp(): boolean {
  return previousPathname() !== null
}
