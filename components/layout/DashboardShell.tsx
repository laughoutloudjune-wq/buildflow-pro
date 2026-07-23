'use client'

import { useEffect, useState } from 'react'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import type { PermissionModule } from '@/lib/permissions'

const COLLAPSED_STORAGE_KEY = 'buildflow.sidebar-collapsed'

export default function DashboardShell({
  permissions,
  userEmail,
  role,
  children,
}: {
  permissions: Record<PermissionModule, boolean>
  userEmail?: string
  role?: string
  children: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const stored = window.localStorage.getItem(COLLAPSED_STORAGE_KEY)
    if (stored === '1') setCollapsed(true)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? '1' : '0')
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
