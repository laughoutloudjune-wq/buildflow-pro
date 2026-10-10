import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Activity, AlertTriangle, BadgeCheck, Building2, CheckCircle2, Clock3, Home, ShieldAlert, Sparkles, TrendingUp, Wallet, ChevronRight, HardHat, ShoppingCart, Tag, UserX } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { PageSection } from '@/components/ui/PageSection'
import { DEFAULT_THEME, getThemeByDepartmentId, type DepartmentTheme } from '@/lib/navigation'
import { ButtonLink } from '@/components/ui/Button'
import { getDashboardStats } from '@/actions/dashboard-actions'
import { getDashboardWeek } from '@/actions/dashboard-week-actions'
import { getWorkRequestCounts } from '@/actions/sales-work-requests'
import { getDashboardSession, permissionsForRole } from '@/lib/auth/route-access'
import { formatCurrency } from '@/lib/currency'
import { WORK_REQUEST_CATEGORY_LABEL } from '@/lib/sales/workRequestCategories'
import { formatWeekRange } from '@/lib/weekly-plan'

function riskLevelTone(level: string) {
  if (level === 'high') return 'danger'
  if (level === 'medium') return 'warning'
  return 'success'
}

export default async function DashboardPage() {
  const { role, permissions: rolePermissions } = await getDashboardSession()
  const perms = permissionsForRole(role, rolePermissions)

  // Sales never sees construction money (Q-08), and this page is the
  // construction overview - so sales roles go straight to their own
  // dashboard instead of landing on a "go somewhere else" card. The
  // permission check avoids a redirect loop: a sales role with the sales
  // module switched off is sent back here by requireModuleAccess.
  if ((role === 'sales' || role === 'sales_exec') && perms.sales) {
    redirect('/dashboard/sales/dashboard')
  }

  const theme = DEFAULT_THEME // the overview's accent is indigo
  const [stats, week] = await Promise.all([getDashboardStats(), getDashboardWeek()])
  // Not everyone who lands on /dashboard cares about the work-request queue
  // (an accountant, say) - only show the card to roles that can actually do
  // something about it, same set the sidebar item itself is gated on.
  const showWorkRequests = perms.sales || perms.foreman || perms.projects
  const workRequestCounts = showWorkRequests ? await getWorkRequestCounts().catch(() => null) : null
  // Everything below shows contractor/billing money in some form (M-03) -
  // only the modules that have any legitimate reason to see it get it.
  const showMoney = perms.billing || perms.reports || perms.cost_control || perms.foreman

  type Kpi = { title: string; value: string | number; hint: string; icon: React.ReactNode; href: string; attention?: boolean }
  const staleCount = stats.foremanQuality?.summary?.stale_requests || 0

  const kpis: Kpi[] = [
    {
      title: 'โครงการทั้งหมด',
      value: stats.projectCount,
      hint: `${stats.plotCount} แปลง`,
      icon: <Building2 className="h-5 w-5 text-blue-600" />,
      href: '/dashboard/projects',
    },
    {
      title: 'งานที่กำลังดำเนินการ',
      value: stats.activeJobs,
      hint: `${stats.pendingApprovals} รายการรอ PM อนุมัติ`,
      icon: <Activity className="h-5 w-5" />,
      href: '/dashboard/billing',
    },
  ]

  const moneyKpis: Kpi[] = [
    {
      title: 'จ่ายผู้รับเหมาแล้ว',
      value: `฿${formatCurrency(stats.paidOutTotal)}`,
      hint: 'ยอดที่โอนจ่ายจริงสะสม',
      icon: <Wallet className="h-5 w-5" />,
      href: '/dashboard/reports/house-history',
    },
    {
      title: 'อนุมัติเดือนนี้',
      value: `฿${formatCurrency(stats.approvedThisMonth || 0)}`,
      hint: 'ยอดสุทธิใบเบิกที่อนุมัติแล้ว',
      icon: <TrendingUp className="h-5 w-5" />,
      href: '/dashboard/reports/contractor-cycle',
    },
    {
      title: 'จ่ายเดือนนี้',
      value: stats.paidOutThisMonth?.count || 0,
      hint: `฿${formatCurrency(stats.paidOutThisMonth?.amount || 0)} • รายการที่จ่ายแล้ว`,
      icon: <BadgeCheck className="h-5 w-5" />,
      href: '/dashboard/reports/contractor-cycle',
    },
    {
      title: 'อนุมัติล่าสุด',
      value: stats.recentlyApproved?.count || 0,
      hint: `฿${formatCurrency(stats.recentlyApproved?.amount || 0)} • 7 วันล่าสุด${stats.recentlyApproved?.unpaidCount ? ` • รอจ่าย ${stats.recentlyApproved.unpaidCount} รายการ` : ''}`,
      icon: <Sparkles className="h-5 w-5" />,
      href: '/dashboard/reports/contractor-cycle',
    },
    {
      title: 'ต้องตรวจสอบ',
      value: staleCount,
      hint: 'คำขอที่รอเกิน 3 วัน',
      attention: staleCount > 0,
      icon: <AlertTriangle className="h-5 w-5" />,
      href: '/dashboard/billing',
    },
  ]

  return (
    <PageContainer width="wide" className="space-y-8">
      <PageHeader
        title="ภาพรวม"
        subtitle="ภาพรวม KPI ความเสี่ยง คุณภาพงาน และกิจกรรมล่าสุด"
        actions={
          <>
            <ButtonLink variant="secondary" href="/dashboard/billing">คิวรอ PM ตรวจสอบ</ButtonLink>
            <ButtonLink href="/dashboard/reports/contractor-cycle">รอบจ่ายผู้รับเหมา</ButtonLink>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {[...kpis, ...(showMoney ? moneyKpis : [])].map((kpi) => (
          <Link key={kpi.title} href={kpi.href} className="group block h-full">
            <Card
              interactive
              className={`flex h-full min-h-[132px] flex-col p-4 ${kpi.attention ? 'border-amber-300 bg-amber-50/50' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-slate-500">{kpi.title}</p>
                <div className={`rounded-lg p-2 ${kpi.attention ? 'bg-amber-100 text-amber-700' : theme.soft}`}>{kpi.icon}</div>
              </div>
              <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{kpi.value}</p>
              <p className={`mt-1 text-xs ${kpi.attention ? 'font-medium text-amber-800' : 'text-slate-500'}`}>{kpi.hint}</p>
            </Card>
          </Link>
        ))}
      </div>

      {(() => {
        const queue = [
          ...(perms.billing && stats.pendingApprovals > 0
            ? [{ key: 'approvals', title: 'ใบเบิกรอ PM ตรวจสอบ', value: stats.pendingApprovals, hint: 'ตรวจสอบและอนุมัติ', href: '/dashboard/billing', warn: false }]
            : []),
          ...(showMoney && staleCount > 0
            ? [{ key: 'stale', title: 'คำขอที่รอเกิน 3 วัน', value: staleCount, hint: 'ควรตามเรื่อง', href: '/dashboard/billing', warn: true }]
            : []),
          ...(workRequestCounts && workRequestCounts.newCount > 0
            ? [{ key: 'sr-new', title: 'คำขอจากฝ่ายขาย (SR) ใหม่', value: workRequestCounts.newCount, hint: 'รอหน่วยงานก่อสร้างรับเรื่อง', href: '/dashboard/sales-requests', warn: false }]
            : []),
          ...(workRequestCounts && workRequestCounts.overdueCount > 0
            ? [{ key: 'sr-late', title: 'คำขอจากฝ่ายขาย (SR) เกินกำหนด', value: workRequestCounts.overdueCount, hint: 'เกินวันที่ต้องเสร็จ', href: '/dashboard/sales-requests', warn: true }]
            : []),
        ]
        if (queue.length === 0) return null
        return (
          <PageSection title="งานที่ต้องจัดการ" description="รายการที่รอการตัดสินใจหรือเกินกำหนด เรียงจากสิ่งที่ควรทำก่อน">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {queue
                .sort((x, y) => Number(y.warn) - Number(x.warn))
                .map((q) => (
                  <Link key={q.key} href={q.href} className="group block">
                    <Card interactive className={`flex items-center gap-3 p-4 ${q.warn ? 'border-amber-300 bg-amber-50/50' : ''}`}>
                      <div className={`flex h-11 min-w-11 items-center justify-center rounded-xl px-2 text-lg font-semibold tabular-nums ${q.warn ? 'bg-amber-100 text-amber-800' : theme.soft}`}>
                        {q.value}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{q.title}</p>
                        <p className={`text-xs ${q.warn ? 'font-medium text-amber-800' : 'text-slate-500'}`}>{q.hint}</p>
                      </div>
                    </Card>
                  </Link>
                ))}
            </div>
          </PageSection>
        )
      })()}

      {week && !('error' in week) && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-slate-900">สัปดาห์นี้</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{formatWeekRange(week.weekStart)}</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {week.sales && (
              <WeekPanel
                title="งานขาย"
                icon={<Tag className="h-[18px] w-[18px]" />}
                theme={getThemeByDepartmentId('sales')}
                total={week.sales.srCount}
              >
                <WeekRow href="/dashboard/sales-requests" label="คำขอจากฝ่ายขาย (SR)" value={week.sales.srCount} />
                {week.sales.srItems.length > 0 && (
                  <li className="space-y-1 px-2 pb-1 pt-0.5">
                    {week.sales.srItems.map((item) => (
                      <Link key={item.id} href="/dashboard/sales-requests" className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-slate-50">
                        <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${getThemeByDepartmentId('sales').chip}`}>
                          {WORK_REQUEST_CATEGORY_LABEL[item.category] || item.category}
                        </span>
                        <span className="min-w-0 truncate text-slate-600">{item.title}</span>
                      </Link>
                    ))}
                  </li>
                )}
              </WeekPanel>
            )}
            {week.construction && (
              <WeekPanel
                title="งานก่อสร้าง"
                icon={<HardHat className="h-[18px] w-[18px]" />}
                theme={getThemeByDepartmentId('construction')}
                total={week.construction.main + week.construction.inspect + week.construction.repair + week.construction.other + week.construction.dc}
              >
                <WeekRow href="/dashboard/weekly-plan" label="งานหลัก" value={week.construction.main} />
                <WeekRow href="/dashboard/weekly-plan" label="ตรวจบ้าน" value={week.construction.inspect} />
                <WeekRow href="/dashboard/weekly-plan" label="งานซ่อม" value={week.construction.repair} />
                <WeekRow href="/dashboard/weekly-plan" label="งานอื่นๆ" value={week.construction.other} />
                <WeekRow href="/dashboard/weekly-plan" label="งานเพิ่ม (DC)" value={week.construction.dc} />
              </WeekPanel>
            )}
            {week.procurement && (
              <WeekPanel
                title="บัญชี / จัดซื้อ"
                icon={<ShoppingCart className="h-[18px] w-[18px]" />}
                theme={getThemeByDepartmentId('procurement')}
                total={week.procurement.openPrCount}
              >
                <WeekRow href="/dashboard/procurement/requests" label="คำขอซื้อ (PR) ที่ยังเปิดอยู่" value={week.procurement.openPrCount} />
              </WeekPanel>
            )}
            {week.unassigned && (
              <WeekPanel
                title="ยังไม่ได้มอบหมาย"
                icon={<UserX className="h-[18px] w-[18px]" />}
                theme={getThemeByDepartmentId('admin')}
                total={week.unassigned.count}
                warn={week.unassigned.count > 0}
              >
                <WeekRow href="/dashboard/weekly-plan" label="รายการแผนงานที่ไม่มีผู้รับผิดชอบ" value={week.unassigned.count} warn />
              </WeekPanel>
            )}
          </div>
        </Card>
      )}

      {showMoney && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            {stats.projectHealth?.map((project: any) => (
              <Card key={project.project_id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{project.project_name}</p>
                    <p className="text-xs text-slate-500">{project.location}</p>
                  </div>
                  <Badge tone={riskLevelTone(project.risk_level)}>{project.risk_level.toUpperCase()}</Badge>
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                    <span>ความคืบหน้า</span>
                    <span>{project.completion_rate}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-slate-900 transition-[width] duration-[220ms] ease-out" style={{ width: `${Math.max(4, project.completion_rate)}%` }} />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-slate-500">แปลง</p>
                    <p className="font-semibold text-slate-900">{project.total_plots}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-slate-500">งาน</p>
                    <p className="font-semibold text-slate-900">{project.completed_jobs}/{project.total_jobs}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-slate-500">บิลรอตรวจสอบ</p>
                    <p className="font-semibold text-slate-900">{project.pending_bills}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-slate-500">มูลค่าที่อนุมัติ</p>
                    <p className="font-semibold text-slate-900">฿{formatCurrency(project.approved_value || 0)}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">สัญญาณคุณภาพงานของ Foreman</h2>
                <ShieldAlert className="h-5 w-5" />
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                <MetricTile label="ส่งคำขอ" value={stats.foremanQuality?.summary?.total_submissions || 0} />
                <MetricTile label="รอตรวจสอบ" value={stats.foremanQuality?.summary?.pending_review || 0} />
                <MetricTile label="ค้างนาน" value={stats.foremanQuality?.summary?.stale_requests || 0} />
                <MetricTile label="ปฏิเสธ 30 วัน" value={`${stats.foremanQuality?.summary?.rejection_rate_30d || 0}%`} />
              </div>

              <div className="space-y-2">
                {(stats.foremanQuality?.byForeman || []).map((f: any) => (
                  <div key={f.user_id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-slate-900">{f.name}</p>
                      <span className="text-xs text-slate-500">เฉลี่ย ฿{formatCurrency(f.avg_request_value || 0)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
                      <span>ส่ง {f.submitted}</span>
                      <span>อนุมัติ {f.approved}</span>
                      <span>ปฏิเสธ {f.rejected}</span>
                      <span>รอ {f.pending}</span>
                      <span>ค้างนาน {f.stale_pending}</span>
                    </div>
                  </div>
                ))}
                {(stats.foremanQuality?.byForeman || []).length === 0 && (
                  <p className="text-sm text-slate-500">ยังไม่มีกิจกรรมของ Foreman</p>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">ความเสี่ยงผู้รับเหมา</h2>
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>

              <div className="space-y-2">
                {(stats.contractorRisk || []).map((c: any) => (
                  <div key={c.contractor_id} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900">{c.contractor_name}</p>
                      <Badge tone={riskLevelTone(c.risk_level)}>{c.risk_level.toUpperCase()}</Badge>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span>รอตรวจสอบ: {c.pending_count}</span>
                      <span>เกินกำหนด: {c.overdue_pending}</span>
                      <span>ปฏิเสธ 30 วัน: {c.rejected_30d}</span>
                      <span>รอตรวจสอบ ฿{formatCurrency(c.pending_amount || 0)}</span>
                    </div>
                  </div>
                ))}
                {(stats.contractorRisk || []).length === 0 && (
                  <p className="text-sm text-slate-500">ยังไม่มีสัญญาณความเสี่ยงผู้รับเหมา</p>
                )}
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">กิจกรรมล่าสุด</h2>
              <Clock3 className="h-5 w-5 text-slate-500" />
            </div>

            <div className="space-y-3">
              {(stats.recentTimeline || []).map((item: any) => (
                <div key={item.id} className="flex items-start gap-3 border-l-2 border-slate-200 pl-3">
                  <div className="mt-0.5">
                    {item.type === 'payment' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : item.status === 'rejected' ? (
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                    ) : (
                      <Home className="h-4 w-4 text-indigo-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                      <Badge tone={statusTone(item.status)} className="px-2 py-0.5 text-[11px]">{item.status}</Badge>
                    </div>
                    <p className="truncate text-xs text-slate-600">{item.subtitle}</p>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                      <span>{new Date(item.at).toLocaleString('th-TH')}</span>
                      <span className="font-semibold text-slate-700">฿{formatCurrency(item.amount || 0)}</span>
                    </div>
                  </div>
                </div>
              ))}
              {(stats.recentTimeline || []).length === 0 && (
                <p className="text-sm text-slate-500">ยังไม่มีกิจกรรมล่าสุด</p>
              )}
            </div>
          </Card>
        </>
      )}
    </PageContainer>
  )
}

/** One department's slice of the week: accent strip, icon surface, a total and
 * its rows. `warn` switches to amber when the panel holds something unresolved. */
function WeekPanel({
  title,
  icon,
  theme,
  total,
  warn,
  children,
}: {
  title: string
  icon: React.ReactNode
  theme: DepartmentTheme
  total: number
  warn?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={`overflow-hidden rounded-xl border ${warn ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200/70 bg-white'}`}>
      <div aria-hidden className={`h-[3px] ${warn ? 'bg-amber-400' : theme.solid}`} />
      <header className="flex items-center gap-3 px-4 pb-2 pt-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${warn ? 'bg-amber-100 text-amber-700' : theme.soft}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900">{title}</h3>
          <p className={`text-xs ${warn ? 'font-medium text-amber-800' : 'text-slate-500'}`}>
            {warn ? `ต้องจัดการ ${total} รายการ` : total > 0 ? `${total} รายการ` : 'ไม่มีรายการ'}
          </p>
        </div>
      </header>
      <ul className="px-2 pb-2">{children}</ul>
    </section>
  )
}

function WeekRow({ href, label, value, warn }: { href: string; label: string; value: number; warn?: boolean }) {
  return (
    <li>
      <Link href={href} className="group flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-900/[0.04]">
        <span className={`text-sm ${value > 0 ? 'text-slate-800' : 'text-slate-500'}`}>{label}</span>
        <span className="flex items-center gap-1">
          <span
            className={`min-w-9 rounded-md px-2 py-0.5 text-center text-sm font-semibold tabular-nums ${
              value === 0 ? 'text-slate-500' : warn ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-900'
            }`}
          >
            {value}
          </span>
          <ChevronRight className="h-4 w-4 text-slate-400 transition-colors group-hover:text-slate-600" aria-hidden />
        </span>
      </Link>
    </li>
  )
}

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2 text-center">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
    </div>
  )
}
