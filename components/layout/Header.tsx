'use client'

import { User } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { getDashboardPageTitle } from '@/lib/dashboard-page-titles'
import NotificationBell from '@/components/layout/NotificationBell'

export default function Header({ userEmail, role }: { userEmail?: string; role?: string }) {
  const pathname = usePathname()
  const pageTitle = getDashboardPageTitle(pathname)

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-200/70 bg-white/75 px-4 backdrop-blur-xl sm:px-6">
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold tracking-tight text-slate-900" title={pageTitle}>
          {pageTitle}
        </p>
        <p className="hidden text-xs text-slate-500 sm:block">BuildFlow</p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2 sm:gap-4">
        <NotificationBell role={role} />

        <div className="flex items-center gap-2 border-l border-slate-200/70 pl-3 sm:gap-3 sm:pl-4">
          <div className="text-right hidden min-w-0 sm:block">
            <div className="text-sm font-medium text-slate-700">ผู้ใช้งาน</div>
            <div className="truncate text-xs text-slate-500" title={userEmail || undefined}>
              {userEmail || '…'}
            </div>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 sm:h-10 sm:w-10" aria-hidden>
            <User className="h-5 w-5" />
          </div>
        </div>
      </div>
    </header>
  )
}
