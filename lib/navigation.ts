import {
  LayoutDashboard,
  HardHat,
  FileText,
  Settings,
  Building2,
  Users,
  ClipboardList,
  BarChart3,
  ShoppingCart,
  Truck,
  Package,
  PackageCheck,
  Wallet,
  GaugeCircle,
  Tag,
  ClipboardCheck,
  CalendarDays,
} from 'lucide-react'
import type { PermissionModule } from '@/lib/permissions'

/**
 * Single source of truth for "which department does this page belong to".
 * The sidebar, the header breadcrumb and page titles all read from here, so a
 * route can't be in one department in the menu and another in the header.
 *
 * Visual rule: each department has one accent colour, used for identity only:
 * sidebar group and active item, top-bar stripe, the department eyebrow and
 * accent rule on every page, selected filters/tabs and small icon surfaces.
 * Primary buttons, focus rings and status colours never take the department
 * colour. The accents avoid green, amber and red, which stay reserved for
 * status. Never hard-code a department colour in a page: read the theme.
 */
export type DepartmentTheme = {
  /** Section title / label text */
  text: string
  /** Active menu item background + text */
  active: string
  /** Icon colour on the active item */
  icon: string
  /** Solid dot / stripe */
  solid: string
  /** Faint top-bar wash */
  wash: string
  /** Pale surface for selected / contextual areas */
  tint: string
  /** Small icon surface: background + icon colour */
  soft: string
  /** Removable filter chip */
  chip: string
  /** Selected tab / filter pill */
  pill: string
  /** Selected option card or toggle: border + background + text */
  selected: string
  /** Solid marker (current step number) */
  stepSolid: string
  /** Selected tab: underline + text */
  tab: string
}

export const DEFAULT_THEME: DepartmentTheme = {
  text: 'text-indigo-700',
  active: 'bg-indigo-50 text-indigo-700',
  icon: 'text-indigo-600',
  solid: 'bg-indigo-500',
  wash: 'bg-indigo-50/60',
  tint: 'bg-indigo-50',
  soft: 'bg-indigo-50 text-indigo-600',
  chip: 'bg-indigo-50 text-indigo-700',
  pill: 'bg-indigo-100 text-indigo-800 ring-1 ring-inset ring-indigo-200',
  selected: 'border-indigo-300 bg-indigo-50 text-indigo-700',
  stepSolid: 'bg-indigo-500 text-white',
  tab: 'border-indigo-600 text-indigo-700',
}

const THEMES: Record<'orange' | 'violet' | 'blue' | 'cyan' | 'pink' | 'slate', DepartmentTheme> = {
  orange: { text: 'text-orange-700', active: 'bg-orange-50 text-orange-700', icon: 'text-orange-600', solid: 'bg-orange-500', wash: 'bg-orange-50/60', tint: 'bg-orange-50', soft: 'bg-orange-50 text-orange-600', chip: 'bg-orange-50 text-orange-700', pill: 'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-200', selected: 'border-orange-300 bg-orange-50 text-orange-700', stepSolid: 'bg-orange-500 text-white', tab: 'border-orange-500 text-orange-700' },
  violet: { text: 'text-violet-700', active: 'bg-violet-50 text-violet-700', icon: 'text-violet-600', solid: 'bg-violet-500', wash: 'bg-violet-50/60', tint: 'bg-violet-50', soft: 'bg-violet-50 text-violet-600', chip: 'bg-violet-50 text-violet-700', pill: 'bg-violet-100 text-violet-800 ring-1 ring-inset ring-violet-200', selected: 'border-violet-300 bg-violet-50 text-violet-700', stepSolid: 'bg-violet-500 text-white', tab: 'border-violet-500 text-violet-700' },
  blue: { text: 'text-blue-700', active: 'bg-blue-50 text-blue-700', icon: 'text-blue-600', solid: 'bg-blue-500', wash: 'bg-blue-50/60', tint: 'bg-blue-50', soft: 'bg-blue-50 text-blue-600', chip: 'bg-blue-50 text-blue-700', pill: 'bg-blue-100 text-blue-800 ring-1 ring-inset ring-blue-200', selected: 'border-blue-300 bg-blue-50 text-blue-700', stepSolid: 'bg-blue-500 text-white', tab: 'border-blue-500 text-blue-700' },
  cyan: { text: 'text-cyan-700', active: 'bg-cyan-50 text-cyan-700', icon: 'text-cyan-600', solid: 'bg-cyan-500', wash: 'bg-cyan-50/60', tint: 'bg-cyan-50', soft: 'bg-cyan-50 text-cyan-600', chip: 'bg-cyan-50 text-cyan-700', pill: 'bg-cyan-100 text-cyan-800 ring-1 ring-inset ring-cyan-200', selected: 'border-cyan-300 bg-cyan-50 text-cyan-700', stepSolid: 'bg-cyan-500 text-white', tab: 'border-cyan-500 text-cyan-700' },
  pink: { text: 'text-pink-700', active: 'bg-pink-50 text-pink-700', icon: 'text-pink-600', solid: 'bg-pink-500', wash: 'bg-pink-50/60', tint: 'bg-pink-50', soft: 'bg-pink-50 text-pink-600', chip: 'bg-pink-50 text-pink-700', pill: 'bg-pink-100 text-pink-800 ring-1 ring-inset ring-pink-200', selected: 'border-pink-300 bg-pink-50 text-pink-700', stepSolid: 'bg-pink-500 text-white', tab: 'border-pink-500 text-pink-700' },
  slate: { text: 'text-slate-700', active: 'bg-slate-100 text-slate-800', icon: 'text-slate-600', solid: 'bg-slate-500', wash: 'bg-slate-100/70', tint: 'bg-slate-100', soft: 'bg-slate-100 text-slate-600', chip: 'bg-slate-100 text-slate-700', pill: 'bg-slate-200 text-slate-900 ring-1 ring-inset ring-slate-300', selected: 'border-slate-400 bg-slate-100 text-slate-800', stepSolid: 'bg-slate-600 text-white', tab: 'border-slate-500 text-slate-700' },
}
export type DepartmentId = 'construction' | 'boq' | 'procurement' | 'stock' | 'sales' | 'admin'

export type NavItem = {
  icon: typeof LayoutDashboard
  label: string
  href: string
  /** A single module, or an array meaning "any of these". */
  permission?: PermissionModule | PermissionModule[]
  /**
   * Shared workflows belong to more than one department (e.g. sales raise a
   * work request, construction works it). The item is listed once, under the
   * first department here that the viewer otherwise has access to.
   */
  sharedWith?: DepartmentId[]
}

export type Department = {
  id: DepartmentId
  label: string
  theme: DepartmentTheme
  /** Every route prefix that belongs to this department, whether or not it
   * has a menu entry (detail pages, print views, create forms). */
  prefixes: string[]
  items: NavItem[]
}

export const OVERVIEW_ITEM: NavItem = { icon: LayoutDashboard, label: 'ภาพรวม', href: '/dashboard' }

export const DEPARTMENTS: Department[] = [
  {
    id: 'construction',
    theme: THEMES.orange,
    label: 'ก่อสร้าง',
    prefixes: [
      '/dashboard/projects',
      '/dashboard/contractors',
      '/dashboard/billing',
      '/dashboard/foreman',
      '/dashboard/weekly-plan',
      '/dashboard/sales-requests',
    ],
    items: [
      { icon: Building2, label: 'โครงการ', href: '/dashboard/projects', permission: 'projects' },
      { icon: CalendarDays, label: 'แผนงาน', href: '/dashboard/weekly-plan', permission: 'projects' },
      { icon: HardHat, label: 'ตรวจหน้างาน', href: '/dashboard/foreman/create-progress', permission: 'foreman' },
      { icon: FileText, label: 'รายการเบิกจ่าย', href: '/dashboard/billing', permission: 'billing' },
      { icon: Users, label: 'ผู้รับเหมา', href: '/dashboard/contractors', permission: 'contractors' },
      {
        icon: ClipboardCheck,
        label: 'คำขอจากฝ่ายขาย (SR)',
        href: '/dashboard/sales-requests',
        permission: ['sales', 'foreman', 'projects'],
        sharedWith: ['sales'],
      },
    ],
  },
  {
    id: 'boq',
    theme: THEMES.violet,
    label: 'BOQ & ต้นทุน',
    prefixes: ['/dashboard/boq', '/dashboard/cost-control'],
    items: [
      { icon: ClipboardList, label: 'แบบบ้าน & BOQ', href: '/dashboard/boq', permission: 'boq' },
      { icon: GaugeCircle, label: 'คุม BOQ & ต้นทุน', href: '/dashboard/cost-control', permission: 'cost_control' },
    ],
  },
  {
    id: 'procurement',
    theme: THEMES.blue,
    label: 'จัดซื้อ',
    prefixes: ['/dashboard/procurement'],
    items: [
      { icon: ShoppingCart, label: 'คำขอซื้อ (PR)', href: '/dashboard/procurement/requests', permission: 'procurement' },
      { icon: Truck, label: 'ใบสั่งซื้อ (PO)', href: '/dashboard/procurement/orders', permission: 'procurement' },
      { icon: PackageCheck, label: 'ใบรับสินค้า', href: '/dashboard/procurement/receipts', permission: 'procurement' },
      { icon: Wallet, label: 'ใบสำคัญจ่าย', href: '/dashboard/procurement/payments', permission: 'procurement' },
    ],
  },
  {
    id: 'stock',
    theme: THEMES.cyan,
    label: 'สต็อก',
    prefixes: ['/dashboard/stock'],
    items: [{ icon: Package, label: 'สต็อกวัสดุ', href: '/dashboard/stock', permission: 'materials' }],
  },
  {
    id: 'sales',
    theme: THEMES.pink,
    label: 'ฝ่ายขาย',
    prefixes: ['/dashboard/sales'],
    items: [
      { icon: BarChart3, label: 'แดชบอร์ดขาย', href: '/dashboard/sales/dashboard', permission: 'sales' },
      { icon: Tag, label: 'ผังการขาย', href: '/dashboard/sales', permission: 'sales' },
      { icon: Tag, label: 'โปรโมชั่น', href: '/dashboard/sales/promotions', permission: 'sales' },
    ],
  },
  {
    id: 'admin',
    theme: THEMES.slate,
    label: 'รายงานและระบบ',
    prefixes: ['/dashboard/reports', '/dashboard/settings'],
    items: [
      { icon: BarChart3, label: 'รายงานงานเพิ่ม (DC)', href: '/dashboard/reports/dc-history', permission: 'reports' },
      { icon: BarChart3, label: 'ประวัติบ้านเลขที่', href: '/dashboard/reports/house-history', permission: 'reports' },
      { icon: BarChart3, label: 'รอบจ่ายผู้รับเหมา', href: '/dashboard/reports/contractor-cycle', permission: 'reports' },
      { icon: BarChart3, label: 'สมุดบัญชีค่าแรง', href: '/dashboard/reports/labor-budget', permission: 'reports' },
      { icon: Settings, label: 'ตั้งค่า', href: '/dashboard/settings', permission: 'settings' },
    ],
  },
]

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/** Theme of a department by id (for server components that are not under the shell's context). */
export function getThemeByDepartmentId(id: DepartmentId): DepartmentTheme {
  return DEPARTMENTS.find((d) => d.id === id)?.theme ?? DEFAULT_THEME
}

/** Static owner of a path (longest matching prefix), or null for the
 * overview page. Shared routes resolve to the department listed in their
 * `prefixes`; use `getDepartmentLabelForViewer` for what a given viewer sees. */
export function getDepartmentForPath(pathname: string | null): Department | null {
  if (!pathname) return null
  let best: { dept: Department; len: number } | null = null
  for (const dept of DEPARTMENTS) {
    for (const prefix of dept.prefixes) {
      if (matchesPrefix(pathname, prefix) && (!best || prefix.length > best.len)) {
        best = { dept, len: prefix.length }
      }
    }
  }
  return best?.dept ?? null
}

type Permissions = Record<PermissionModule, boolean>

function canSee(item: NavItem, permissions: Permissions) {
  if (!item.permission) return true
  const required = Array.isArray(item.permission) ? item.permission : [item.permission]
  return required.some((p) => permissions[p])
}

export type VisibleDepartment = { id: DepartmentId; label: string; theme: DepartmentTheme; items: NavItem[] }

/** Sidebar content for one viewer: departments in fixed order (the same for
 * every role), filtered by permission. A shared item is placed in the first
 * of its departments where the viewer has other, non-shared access, so it
 * never appears twice. */
export function getVisibleDepartments(permissions: Permissions): VisibleDepartment[] {
  const ownItems = (dept: Department) => dept.items.filter((i) => canSee(i, permissions) && !i.sharedWith)

  const placed = new Map<string, DepartmentId>()
  for (const dept of DEPARTMENTS) {
    for (const item of dept.items) {
      if (!item.sharedWith || !canSee(item, permissions)) continue
      const candidates = [dept.id, ...item.sharedWith]
      const home =
        candidates.find((id) => ownItems(DEPARTMENTS.find((d) => d.id === id)!).length > 0) ?? dept.id
      placed.set(item.href, home)
    }
  }

  return DEPARTMENTS.map((dept) => ({
    id: dept.id,
    label: dept.label,
    theme: dept.theme,
    items: [
      ...ownItems(dept),
      ...DEPARTMENTS.flatMap((d) => d.items)
        .filter((i) => i.sharedWith && placed.get(i.href) === dept.id)
        // Dedupe: the item is defined once, but be safe.
        .filter((i, idx, arr) => arr.findIndex((x) => x.href === i.href) === idx),
    ],
  })).filter((d) => d.items.length > 0)
}

/** Department to show in the header for this viewer: for a shared page it is
 * the department the sidebar placed the entry under, so the header and the
 * menu always agree. */
export function getDepartmentForViewer(
  pathname: string | null,
  permissions: Permissions,
): { label: string; theme: DepartmentTheme } | null {
  if (!pathname) return null
  const shared = DEPARTMENTS.flatMap((d) => d.items).find((i) => i.sharedWith && matchesPrefix(pathname, i.href))
  if (shared) {
    const home = getVisibleDepartments(permissions).find((d) => d.items.some((i) => i.href === shared.href))
    if (home) return { label: home.label, theme: home.theme }
  }
  const dept = getDepartmentForPath(pathname)
  return dept ? { label: dept.label, theme: dept.theme } : null
}
