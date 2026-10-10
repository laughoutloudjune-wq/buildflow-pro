import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Standard content frame. Pick the width by page type instead of inventing a
 * max-w per page:
 *   wide     1440px  dashboards, listings
 *   standard 1200px  detail pages and mixed content
 *   form     960px   complex forms
 *   narrow   720px   short settings / single-purpose forms
 * Dense report grids and maps may skip the container and use the full width.
 */
const widths = {
  wide: 'max-w-[1440px]',
  standard: 'max-w-[1200px]',
  form: 'max-w-[960px]',
  narrow: 'max-w-[720px]',
} as const

export type PageWidth = keyof typeof widths

export function PageContainer({
  width = 'wide',
  className,
  children,
}: {
  width?: PageWidth
  className?: string
  children: React.ReactNode
}) {
  return <div className={cn('mx-auto w-full space-y-6 pb-10', widths[width], className)}>{children}</div>
}
