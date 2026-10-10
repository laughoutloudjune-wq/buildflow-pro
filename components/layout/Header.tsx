'use client'

import { User } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { getDashboardPageTitle } from '@/lib/dashboard-page-titles'
import { DEFAULT_THEME, getDepartmentForViewer } from '@/lib/navigation'
import type { PermissionModule } from '@/lib/permissions'
import NotificationBell from '@/components/layout/NotificationBell'
import ProjectQuickSwitcher from '@/components/layout/ProjectQuickSwitcher'

export default function Header({
  userEmail,
  role,
  canViewProjects,
  permissions,
}: {
  userEmail?: string
  role?: string
  canViewProjects?: boolean
  permissions: Record<PermissionModule, boolean>
}) {
  const pathname = usePathname()
  const pageTitle = getDashboardPageTitle(pathname)
  const department = getDepartmentForViewer(pathname, permissions)
  const theme = department?.theme ?? DEFAULT_THEME

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full shrink-0 items-center justify-between border-b border-slate-200/70 bg-white/75 px-4 backdrop-blur-xl sm:px-6">
      {/* Department stripe + wash: the colour is the quickest "where am I" cue. */}
      <div aria-hidden className={`pointer-events-none absolute inset-0 ${theme.wash}`} />
      <div aria-hidden className={`absolute inset-x-0 top-0 h-[3px] ${theme.solid}`} />
      {/* Department / page, so the viewer knows where they are even on a deep
          link or with the sidebar collapsed. */}
      <div className="relative flex min-w-0 flex-col justify-center">
        {department && (
          <p className={`truncate text-[11px] font-semibold leading-tight ${theme.text}`}>{department.label}</p>
        )}
        <p className="truncate text-[15px] font-semibold leading-tight tracking-tight text-slate-900" title={pageTitle}>
          {pageTitle}
        </p>
      </div>

      <div className="relative flex flex-shrink-0 items-center gap-2 sm:gap-4">
        {canViewProjects && <ProjectQuickSwitcher />}
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
