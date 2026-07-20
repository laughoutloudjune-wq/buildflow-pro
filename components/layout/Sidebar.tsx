'use client'

import {
  LayoutDashboard,
  HardHat,
  FileText,
  Settings,
  LogOut,
  Building2,
  Users,
  ClipboardList,
  BarChart3,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { PermissionModule } from '@/lib/permissions'

type CurrentPermissions = Record<PermissionModule, boolean>
type SidebarItem = {
  icon: typeof LayoutDashboard
  label: string
  href: string
  permission?: PermissionModule
}
type SidebarSection = {
  title: string
  items: SidebarItem[]
}

const menuSections: SidebarSection[] = [
  {
    title: 'ภาพรวม',
    items: [{ icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'ข้อมูลหลัก',
    items: [
      { icon: Building2, label: 'โครงการ', href: '/dashboard/projects', permission: 'projects' as const },
      { icon: ClipboardList, label: 'แบบบ้าน & BOQ', href: '/dashboard/boq', permission: 'boq' as const },
      { icon: Users, label: 'ผู้รับเหมา', href: '/dashboard/contractors', permission: 'contractors' as const },
    ],
  },
  {
    title: 'งานประจำวัน',
    items: [
      { icon: HardHat, label: 'ตรวจหน้างาน (Foreman)', href: '/dashboard/foreman/create-progress', permission: 'foreman' as const },
      { icon: FileText, label: 'รายการเบิกจ่าย (For PM)', href: '/dashboard/billing', permission: 'billing' as const },
    ],
  },
  {
    title: 'รายงาน',
    items: [
      { icon: BarChart3, label: 'รายงาน DC', href: '/dashboard/reports/dc-history', permission: 'reports' as const },
      { icon: BarChart3, label: 'ประวัติบ้านเลขที่', href: '/dashboard/reports/house-history', permission: 'reports' as const },
      { icon: BarChart3, label: 'รอบจ่ายผู้รับเหมา', href: '/dashboard/reports/contractor-cycle', permission: 'reports' as const },
    ],
  },
  {
    title: 'ระบบ',
    items: [{ icon: Settings, label: 'ตั้งค่า', href: '/dashboard/settings', permission: 'settings' as const }],
  },
]

export default function Sidebar({
  permissions,
  collapsed,
  onToggleCollapsed,
}: {
  permissions: CurrentPermissions
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const visibleSections = menuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => (item.permission ? permissions[item.permission] : true)),
    }))
    .filter((section) => section.items.length > 0)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <aside
      className={`fixed left-0 top-0 z-40 h-screen border-r border-slate-200/70 bg-white/80 backdrop-blur-xl transition-[width] duration-200 ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      <button
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
        title={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
        className="absolute -right-3 top-20 z-50 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-[0_1px_3px_rgba(0,0,0,0.1)] transition-colors hover:text-indigo-600"
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>

      <div className={`flex h-16 items-center border-b border-slate-200/70 ${collapsed ? 'justify-center px-2' : 'px-6'}`}>
        <div className="flex items-center gap-2.5 overflow-hidden text-[17px] font-semibold tracking-tight text-slate-900">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-indigo-600 shadow-[0_2px_6px_-1px_rgba(79,70,229,0.5)]">
            <Building2 className="h-4.5 w-4.5 text-white" />
          </div>
          {!collapsed && <span className="whitespace-nowrap">BuildFlow</span>}
        </div>
      </div>

      <nav className="scrollbar-modern h-[calc(100vh-8.5rem)] overflow-y-auto overflow-x-hidden p-3">
        <div className="space-y-5">
          {visibleSections.map((section) => (
            <div key={section.title}>
              {!collapsed && (
                <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {section.title}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = pathname.startsWith(item.href) && item.href !== '/dashboard'
                    ? true
                    : pathname === item.href

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center gap-3 rounded-[10px] py-2.5 text-[14px] font-medium transition-colors ${
                        collapsed ? 'justify-center px-0' : 'px-3'
                      } ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900'
                      }`}
                    >
                      <item.icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                      {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="absolute bottom-4 left-0 w-full px-3">
        <button
          onClick={handleLogout}
          title={collapsed ? 'ออกจากระบบ' : undefined}
          className={`flex w-full items-center gap-3 rounded-[10px] py-2.5 text-[14px] font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 ${
            collapsed ? 'justify-center px-0' : 'px-3'
          }`}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span className="whitespace-nowrap">ออกจากระบบ</span>}
        </button>
      </div>
    </aside>
  )
}
