'use client'

import { LogOut, Building2, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { PermissionModule } from '@/lib/permissions'
import { DEFAULT_THEME, OVERVIEW_ITEM, getVisibleDepartments } from '@/lib/navigation'

type CurrentPermissions = Record<PermissionModule, boolean>

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
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const toggleSection = (title: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }
  // Same department order for every role; permissions only hide entries.
  const visibleSections = [
    { title: 'ภาพรวม', theme: DEFAULT_THEME, items: [OVERVIEW_ITEM] },
    ...getVisibleDepartments(permissions).map((d) => ({ title: d.label, theme: d.theme, items: d.items })),
  ]

  // The single most-specific href match wins, computed once across every
  // item rather than each item checking independently - otherwise a nested
  // route like "/dashboard/sales/dashboard" lights up both itself AND its
  // parent "/dashboard/sales" nav entry at the same time.
  const activeHref = visibleSections
    .flatMap((s) => s.items)
    .filter((item) => pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <aside
      className={`fixed left-0 top-0 z-40 h-screen border-r border-slate-200/70 bg-white transition-[width] duration-200 ${
        collapsed ? 'w-20' : 'w-64 max-lg:w-20'
      }`}
    >
      <button
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
        title={collapsed ? 'ขยายเมนู' : 'ย่อเมนู'}
        className="absolute -right-3 top-20 z-50 flex h-6 w-6 max-lg:hidden items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-[0_1px_3px_rgba(0,0,0,0.1)] transition-colors hover:text-indigo-600"
      >
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
      </button>

      <div className={`flex h-16 items-center border-b border-slate-200/70 ${collapsed ? 'justify-center px-2' : 'px-6 max-lg:justify-center max-lg:px-2'}`}>
        <div className="flex items-center gap-2.5 overflow-hidden text-[17px] font-semibold tracking-tight text-slate-900">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-indigo-600 shadow-[0_2px_6px_-1px_rgba(79,70,229,0.5)]">
            <Building2 className="h-4.5 w-4.5 text-white" />
          </div>
          {!collapsed && <span className="whitespace-nowrap max-lg:hidden">BuildFlow</span>}
        </div>
      </div>

      <nav className="scrollbar-modern h-[calc(100vh-8.5rem)] overflow-y-auto overflow-x-hidden p-3">
        <div className="space-y-5">
          {visibleSections.map((section) => {
            const isSectionCollapsed = !collapsed && collapsedSections.has(section.title)
            return (
              <div key={section.title}>
                {collapsed && (
                  <div aria-hidden title={section.title} className={`mx-auto mb-2 h-1 w-6 rounded-full ${section.theme.solid}`} />
                )}
                {!collapsed && (
                  <div aria-hidden title={section.title} className={`mx-auto mb-2 hidden h-1 w-6 rounded-full max-lg:block ${section.theme.solid}`} />
                )}
                {!collapsed && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.title)}
                    className={`mb-1.5 flex w-full items-center justify-between gap-2 rounded-[8px] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider max-lg:hidden ${section.theme.text} transition-colors hover:bg-slate-900/[0.04]`}
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden className={`h-2 w-2 rounded-full ${section.theme.solid}`} />
                      {section.title}
                    </span>
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${isSectionCollapsed ? '-rotate-90' : ''}`} />
                  </button>
                )}
                <div
                  className={`grid transition-[grid-template-rows] duration-[180ms] ease-out ${isSectionCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
                  // Hidden items must not be reachable by keyboard.
                  inert={isSectionCollapsed || undefined}
                >
                  <div className="min-h-0 space-y-0.5 overflow-hidden">
                    {section.items.map((item) => {
                      // Segment-boundary prefix match, not a raw string
                      const isActive = item.href === activeHref

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          title={item.label}
                          aria-current={isActive ? 'page' : undefined}
                          className={`flex items-center gap-3 rounded-[10px] py-2.5 text-[14px] font-medium transition-colors ${
                            collapsed ? 'justify-center px-0' : 'px-3 max-lg:justify-center max-lg:px-0'
                          } ${
                            isActive
                              ? section.theme.active
                              : 'text-slate-600 hover:bg-slate-900/[0.04] hover:text-slate-900'
                          }`}
                        >
                          <item.icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? section.theme.icon : 'text-slate-400'}`} />
                          {!collapsed && <span className="whitespace-nowrap max-lg:hidden">{item.label}</span>}
                        </Link>
                      )
                    })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </nav>

      <div className="absolute bottom-4 left-0 w-full px-3">
        <button
          onClick={handleLogout}
          title="ออกจากระบบ"
          className={`flex w-full items-center gap-3 rounded-[10px] py-2.5 text-[14px] font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 ${
            collapsed ? 'justify-center px-0' : 'px-3 max-lg:justify-center max-lg:px-0'
          }`}
        >
          <LogOut className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span className="whitespace-nowrap max-lg:hidden">ออกจากระบบ</span>}
        </button>
      </div>
    </aside>
  )
}
