'use server'

import { createClient } from '@/lib/supabase/server'
import { getDashboardSession, permissionsForRole } from '@/lib/auth/route-access'
import { todayInBangkok } from '@/lib/utils'

export type WeekSrItem = { id: string; title: string; category: string }

export type DashboardWeek = {
  weekStart: string
  weekEnd: string
  show: { sales: boolean; construction: boolean; procurement: boolean; unassigned: boolean }
  sales: { srCount: number; srItems: WeekSrItem[]; trCount: number } | null
  construction: { main: number; inspect: number; other: number; dc: number } | null
  procurement: { openPrCount: number } | null
  unassigned: { count: number } | null
}

/** Monday (Asia/Bangkok) of the current week and the following Sunday, as YYYY-MM-DD. */
function bangkokWeekRange(): { start: string; end: string } {
  const [y, m, d] = todayInBangkok().split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const offset = (date.getUTCDay() + 6) % 7 // Monday = 0
  const monday = new Date(date.getTime() - offset * 86400000)
  const sunday = new Date(monday.getTime() + 6 * 86400000)
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  return { start: iso(monday), end: iso(sunday) }
}

// weekly_plan_items / transfer_requests may not exist in the database yet
// (and are not in the generated types), so every read on them is untyped and
// any failure - missing table included - falls back to an empty result
// instead of breaking the dashboard.
async function safeCount(run: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const res = await run()
    if (res.error) return 0
    return res.count || 0
  } catch {
    return 0
  }
}

export async function getDashboardWeek(): Promise<DashboardWeek | { error: string }> {
  try {
    const { user, role, permissions } = await getDashboardSession()
    if (!user) return { error: 'กรุณาเข้าสู่ระบบ' }
    // Sales has its own dashboard and never sees construction figures.
    if (role === 'sales' || role === 'sales_exec') return { error: 'ไม่มีสิทธิ์ดูข้อมูลนี้' }

    const perms = permissionsForRole(role, permissions)
    const show = {
      sales: Boolean(perms.sales || perms.foreman || perms.projects),
      construction: Boolean(perms.projects || perms.foreman),
      procurement: Boolean(perms.procurement),
      unassigned: Boolean(perms.projects || perms.foreman),
    }
    const { start, end } = bangkokWeekRange()
    const supabase = await createClient()
    // Untyped handle for tables that are not in the generated types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const planCount = (kind: string) =>
      safeCount(() =>
        db.from('weekly_plan_items').select('id', { count: 'exact', head: true }).eq('week_start', start).eq('kind', kind),
      )

    const [sales, construction, procurement, unassigned] = await Promise.all([
      show.sales
        ? (async () => {
            let srCount = 0
            let srItems: WeekSrItem[] = []
            try {
              const res = await supabase
                .from('sales_work_requests')
                .select('id, title, category', { count: 'exact' })
                .not('status', 'in', '(done,rejected)')
                .order('created_at', { ascending: false })
                .limit(3)
              if (!res.error) {
                srCount = res.count || 0
                srItems = (res.data || []).map((r: { id: string; title: string; category: string }) => ({
                  id: r.id,
                  title: r.title,
                  category: r.category,
                }))
              }
            } catch {
              // leave zero
            }
            const trCount = await safeCount(() =>
              db.from('transfer_requests').select('id', { count: 'exact', head: true }).in('status', ['draft', 'submitted', 'approved']),
            )
            return { srCount, srItems, trCount }
          })()
        : null,
      show.construction
        ? Promise.all([planCount('main'), planCount('inspect'), planCount('other'), planCount('dc')]).then(
            ([main, inspect, other, dc]) => ({ main, inspect, other, dc }),
          )
        : null,
      show.procurement
        ? safeCount(() =>
            supabase.from('purchase_requests').select('id', { count: 'exact', head: true }).in('status', ['pending_review', 'approved']),
          ).then((openPrCount) => ({ openPrCount }))
        : null,
      show.unassigned
        ? safeCount(() =>
            db
              .from('weekly_plan_items')
              .select('id', { count: 'exact', head: true })
              .eq('week_start', start)
              .is('owner_id', null)
              .neq('status', 'done'),
          ).then((count) => ({ count }))
        : null,
    ])

    return { weekStart: start, weekEnd: end, show, sales, construction, procurement, unassigned }
  } catch {
    return { error: 'โหลดข้อมูลสัปดาห์นี้ไม่สำเร็จ' }
  }
}
