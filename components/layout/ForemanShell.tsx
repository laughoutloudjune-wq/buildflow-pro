'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardCheck, ClipboardPlus, History, ShoppingCart } from 'lucide-react'

const navItems = [
  { href: '/dashboard/foreman/create-progress', label: 'เบิกงวดงานหลัก', icon: ClipboardCheck },
  { href: '/dashboard/foreman/create-dc', label: 'งานเพิ่ม (DC)', icon: ClipboardPlus },
  { href: '/dashboard/foreman/purchase-request', label: 'ขอซื้อวัสดุ', icon: ShoppingCart },
  { href: '/dashboard/foreman/history', label: 'ประวัติคำขอ', icon: History },
]

export default function ForemanShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="space-y-6">
      {/* Field-specific tab bar, kept because foremen switch between these four
          tasks constantly. The page title comes from each page's own
          PageHeader and the department from the top bar, so no banner here. */}
      <nav aria-label="เมนูงานหน้างาน" className="flex flex-wrap gap-2 rounded-2xl border border-slate-200/70 bg-white p-2">
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-semibold transition-colors ${
                isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900'
              }`}
            >
              <item.icon className={`h-4 w-4 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {children}
    </div>
  )
}
