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
} from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type UserRole = 'admin' | 'pm' | 'foreman'

const menuSections = [
  {
    title: 'ภาพรวม',
    items: [{ icon: LayoutDashboard, label: 'Dashboard', href: '/dashboard', roles: ['admin', 'pm', 'foreman'] }],
  },
  {
    title: 'ข้อมูลหลัก',
    items: [
      { icon: Building2, label: 'โครงการ', href: '/dashboard/projects', roles: ['admin', 'pm'] },
      { icon: ClipboardList, label: 'แบบบ้าน & BOQ', href: '/dashboard/boq', roles: ['admin', 'pm'] },
      { icon: Users, label: 'ผู้รับเหมา', href: '/dashboard/contractors', roles: ['admin', 'pm'] },
    ],
  },
  {
    title: 'งานประจำวัน',
    items: [
      { icon: HardHat, label: 'ตรวจหน้างาน (Foreman)', href: '/dashboard/foreman/create-progress', roles: ['admin', 'foreman'] },
      { icon: FileText, label: 'รายการเบิกจ่าย (For PM)', href: '/dashboard/billing', roles: ['admin', 'pm'] },
    ],
  },
  {
    title: 'รายงาน',
    items: [
      { icon: BarChart3, label: 'รายงาน DC', href: '/dashboard/reports/dc-history', roles: ['admin', 'pm'] },
      { icon: BarChart3, label: 'ประวัติบ้านเลขที่', href: '/dashboard/reports/house-history', roles: ['admin', 'pm'] },
      { icon: BarChart3, label: 'รอบจ่ายผู้รับเหมา', href: '/dashboard/reports/contractor-cycle', roles: ['admin', 'pm'] },
    ],
  },
  {
    title: 'ระบบ',
    items: [{ icon: Settings, label: 'ตั้งค่า', href: '/dashboard/settings', roles: ['admin'] }],
  },
]

export default function Sidebar({ userRole = 'foreman' }: { userRole?: UserRole }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const visibleSections = menuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.roles.includes(userRole)),
    }))
    .filter((section) => section.items.length > 0)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-slate-900 text-white transition-transform">
      <div className="flex h-16 items-center border-b border-slate-700 px-6">
        <div className="flex items-center gap-2 font-bold text-xl">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-indigo-500">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          BuildFlow
        </div>
      </div>

      <nav className="h-[calc(100vh-8.5rem)] overflow-y-auto p-4">
        <div className="space-y-5">
          {visibleSections.map((section) => (
            <div key={section.title}>
              <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {section.title}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const isActive = pathname.startsWith(item.href) && item.href !== '/dashboard'
                    ? true
                    : pathname === item.href

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 rounded-lg px-4 py-3 text-[15px] font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-600 text-white'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <item.icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="absolute bottom-4 left-0 w-full px-4">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-[15px] font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-red-400"
        >
          <LogOut className="h-5 w-5" />
          ออกจากระบบ
        </button>
      </div>
    </aside>
  )
}
