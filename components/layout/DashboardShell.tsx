'use client'

import { useState } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
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
    <div className="flex h-screen overflow-hidden bg-[#f5f5f7]">
      <Sidebar permissions={permissions} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      <div
        className={`relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden transition-[margin-left] duration-200 ${
          collapsed ? 'ml-20' : 'ml-64'
        }`}
      >
        <Header userEmail={userEmail} role={role} />
        <main className="w-full grow p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
