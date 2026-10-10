'use client'

import { useState } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import { DepartmentProvider } from '@/components/layout/DepartmentContext'
import type { PermissionModule } from '@/lib/permissions'

/** A cookie, not localStorage, so the server can read the preference while
 * rendering and emit the correct sidebar width in the first HTML. Reading it
 * client-side in an effect meant the page always painted expanded and then
 * snapped to collapsed after hydration - a ~176px shift of the entire content
 * column on every navigation. */
export const SIDEBAR_COLLAPSED_COOKIE = 'buildflow.sidebar-collapsed'

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export default function DashboardShell({
  permissions,
  userEmail,
  role,
  initialCollapsed = false,
  children,
}: {
  permissions: Record<PermissionModule, boolean>
  userEmail?: string
  role?: string
  initialCollapsed?: boolean
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed)

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${next ? '1' : '0'}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`
      return next
    })
  }

  return (
    <DepartmentProvider permissions={permissions}>
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar permissions={permissions} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      <div
        className={`relative flex min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden transition-[margin-left] duration-200 will-change-[margin-left] [transition-timing-function:var(--ease-enter)] ${
          collapsed ? 'ml-20' : 'ml-64 max-lg:ml-20'
        }`}
      >
        <Header userEmail={userEmail} role={role} canViewProjects={permissions.projects} permissions={permissions} />
        <main className="w-full min-w-0 grow p-4 sm:p-5 lg:p-6">
          {children}
        </main>
      </div>
    </div>
    </DepartmentProvider>
  )
}
