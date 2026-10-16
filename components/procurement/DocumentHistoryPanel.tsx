'use client'

import { useState } from 'react'
import { ChevronDown, History } from 'lucide-react'
import { getDocumentHistory, type HistoryTarget } from '@/actions/procurement/history'
import type { HistoryEntry } from '@/lib/procurement/documentHistory'
import DocumentHistoryList from '@/components/procurement/DocumentHistoryList'
import { cn } from '@/lib/utils'

/** Collapsed "ประวัติ" block for a PR / PO / receipt / voucher. Loads only when
 * opened, and reloads each time it is reopened so it reflects the latest action. */
export default function DocumentHistoryPanel({ target, className }: { target: HistoryTarget; className?: string }) {
  const [isOpen, setIsOpen] = useState(false)
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  function toggle() {
    const next = !isOpen
    setIsOpen(next)
    if (!next) return
    setIsLoading(true)
    setError(null)
    getDocumentHistory(target)
      .then((result) => {
        if ('error' in result) {
          setError(result.error)
          return
        }
        setEntries(result)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'โหลดประวัติไม่สำเร็จ'))
      .finally(() => setIsLoading(false))
  }

  return (
    <div className={cn('rounded-xl border border-slate-200 bg-white', className)}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-slate-800"
      >
        <History className="h-4 w-4 text-slate-500" />
        ประวัติการเปลี่ยนแปลง
        <ChevronDown className={cn('ml-auto h-4 w-4 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
      </button>
      {isOpen && (
        <div className="border-t border-slate-100 px-4 py-3">
          {isLoading ? (
            <p className="text-sm text-slate-500">กำลังโหลด...</p>
          ) : error ? (
            <p className="text-sm text-rose-600">{error}</p>
          ) : (
            <DocumentHistoryList entries={entries || []} emptyText="ยังไม่มีประวัติ (ระบบเริ่มเก็บประวัติตั้งแต่ 16 ต.ค. 2569)" />
          )}
        </div>
      )}
    </div>
  )
}
