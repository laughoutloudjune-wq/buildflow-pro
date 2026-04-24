'use client'

import { Bell, User } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { getDashboardPageTitle } from '@/lib/dashboard-page-titles'

export default function Header({ userEmail }: { userEmail?: string }) {
  const pathname = usePathname()
  const pageTitle = getDashboardPageTitle(pathname)

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b bg-white px-4 shadow-sm sm:px-6">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-800" title={pageTitle}>
          {pageTitle}
        </p>
        <p className="hidden text-xs text-slate-500 sm:block">BuildFlow</p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2 sm:gap-4">
        <button
          type="button"
          className="hidden rounded-full p-2 text-slate-400 sm:block"
          disabled
          aria-label="การแจ้งเตือน (ยังไม่พร้อมใช้งาน)"
          title="เร็วๆ นี้"
        >
          <Bell className="h-5 w-5" aria-hidden />
        </button>

        <div className="flex items-center gap-2 border-l border-slate-200 pl-3 sm:gap-3 sm:pl-4">
          <div className="text-right hidden min-w-0 sm:block">
            <div className="text-sm font-medium text-slate-700">ผู้ใช้งาน</div>
            <div className="truncate text-xs text-slate-500" title={userEmail || undefined}>
              {userEmail || '…'}
            </div>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 sm:h-10 sm:w-10" aria-hidden>
            <User className="h-5 w-5" />
          </div>
        </div>
      </div>
    </header>
  )
}
