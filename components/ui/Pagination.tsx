'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/Button'

/** Clamp helper shared by every paged list: derives the page count from the
 * row total and pins the requested page inside it, so a list that shrinks
 * underneath the user (a filter narrowing, a row being deactivated) can't
 * leave them stranded on a page that no longer exists. */
export function usePagedRows<T>(rows: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pagedRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [rows, currentPage, pageSize]
  )
  return { pageCount, currentPage, pagedRows }
}

/** The pager strip that sits under a list. Renders nothing when everything
 * fits on one page, so a short list looks exactly as it did before. */
export default function Pagination({
  currentPage,
  pageCount,
  onPageChange,
}: {
  currentPage: number
  pageCount: number
  onPageChange: (updater: (page: number) => number) => void
}) {
  if (pageCount <= 1) return null

  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
      <span className="text-slate-500">
        หน้า <span className="font-semibold text-slate-700">{currentPage}</span> จาก {pageCount}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onPageChange((p) => Math.max(1, p - 1))}
          disabled={currentPage <= 1}
        >
          ก่อนหน้า
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onPageChange((p) => Math.min(pageCount, p + 1))}
          disabled={currentPage >= pageCount}
        >
          ถัดไป
        </Button>
      </div>
    </div>
  )
}
