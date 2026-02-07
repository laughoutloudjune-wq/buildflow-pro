'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { HardHat, ClipboardCheck, ClipboardPlus, History } from 'lucide-react'

const navItems = [
  { href: '/dashboard/foreman/create-progress', label: 'เบิกงวดงานหลัก', icon: ClipboardCheck },
  { href: '/dashboard/foreman/create-dc', label: 'งานเพิ่ม / DC', icon: ClipboardPlus },
  { href: '/dashboard/foreman/history', label: 'ประวัติคำขอ', icon: History },
]

export default function ForemanLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 text-white p-6 shadow">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-amber-400/20 flex items-center justify-center">
            <HardHat className="h-6 w-6 text-amber-300" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Foreman Workflow</h1>
            <p className="text-sm text-slate-300">สร้างคำขอเบิกงวดและงานเพิ่ม เพื่อส่งให้ PM ตรวจสอบ</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  isActive ? 'bg-amber-400 text-slate-900' : 'bg-white/10 text-slate-100 hover:bg-white/20'
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </div>
      </div>

      {children}
    </div>
  )
}
