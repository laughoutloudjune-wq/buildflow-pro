import Link from 'next/link'
import { Activity, AlertTriangle, BadgeCheck, Building2, CheckCircle2, Clock3, ClipboardCheck, Home, ShieldAlert, Sparkles, TrendingUp, Wallet } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { ButtonLink } from '@/components/ui/Button'
import { getDashboardStats } from '@/actions/dashboard-actions'
import { getWorkRequestCounts } from '@/actions/sales-work-requests'
import { getDashboardSession, permissionsForRole } from '@/lib/auth/route-access'
import { formatCurrency } from '@/lib/currency'

function riskLevelTone(level: string) {
  if (level === 'high') return 'danger'
  if (level === 'medium') return 'warning'
  return 'success'
}

export default async function DashboardPage() {
  const { role, permissions: rolePermissions } = await getDashboardSession()
  const perms = permissionsForRole(role, rolePermissions)

  // Sales never sees construction money (Q-08) - rather than picking through
  // a big nested stats object to hide every baht figure in it, sales gets
  // its own lightweight dashboard entirely and never calls getDashboardStats.
  if (role === 'sales') {
    return (
      <div className="space-y-6">
        <PageHeader title="ภาพรวม" subtitle="ยินดีต้อนรับ" />
        <Card className="p-6 text-center">
          <p className="text-sm text-slate-600">หน้านี้สำหรับฝ่ายก่อสร้าง กรุณาไปที่แดชบอร์ดฝ่ายขาย</p>
          <ButtonLink href="/dashboard/sales/dashboard" className="mt-4 inline-flex">
            ไปที่แดชบอร์ดฝ่ายขาย
          </ButtonLink>
        </Card>
      </div>
    )
  }

  const stats = await getDashboardStats()
  // Not everyone who lands on /dashboard cares about the work-request queue
  // (an accountant, say) - only show the card to roles that can actually do
  // something about it, same set the sidebar item itself is gated on.
  const showWorkRequests = perms.sales || perms.foreman || perms.projects
  const workRequestCounts = showWorkRequests ? await getWorkRequestCounts().catch(() => null) : null
  // Everything below shows contractor/billing money in some form (M-03) -
  // only the modules that have any legitimate reason to see it get it.
  const showMoney = perms.billing || perms.reports || perms.cost_control || perms.foreman

  const kpis = [
    {
      title: 'โครงการทั้งหมด',
      value: stats.projectCount,
      hint: `${stats.plotCount} แปลง`,
      icon: <Building2 className="h-5 w-5 text-blue-600" />,
      bg: 'bg-blue-50',
      href: '/dashboard/projects',
    },
    {
      title: 'งานที่กำลังดำเนินการ',
      value: stats.activeJobs,
      hint: `${stats.pendingApprovals} รายการรอ PM อนุมัติ`,
      icon: <Activity className="h-5 w-5 text-indigo-600" />,
      bg: 'bg-indigo-50',
      href: '/dashboard/billing',
    },
  ]

  const moneyKpis = [
    {
      title: 'จ่ายผู้รับเหมาแล้ว',
      value: `฿${formatCurrency(stats.paidOutTotal)}`,
      hint: 'ยอดที่โอนจ่ายจริงสะสม',
      icon: <Wallet className="h-5 w-5 text-emerald-600" />,
      bg: 'bg-emerald-50',
      href: '/dashboard/reports/house-history',
    },
    {
      title: 'อนุมัติเดือนนี้',
      value: `฿${formatCurrency(stats.approvedThisMonth || 0)}`,
      hint: 'ยอดสุทธิใบเบิกที่อนุมัติแล้ว',
      icon: <TrendingUp className="h-5 w-5 text-teal-600" />,
      bg: 'bg-teal-50',
      href: '/dashboard/reports/contractor-cycle',
    },
    {
      title: 'จ่ายเดือนนี้',
      value: stats.paidOutThisMonth?.count || 0,
      hint: `฿${formatCurrency(stats.paidOutThisMonth?.amount || 0)} • รายการที่จ่ายแล้ว`,
      icon: <BadgeCheck className="h-5 w-5 text-emerald-600" />,
      bg: 'bg-emerald-50',
      href: '/dashboard/reports/contractor-cycle',
    },
    {
      title: 'อนุมัติล่าสุด',
      value: stats.recentlyApproved?.count || 0,
      hint: `฿${formatCurrency(stats.recentlyApproved?.amount || 0)} • 7 วันล่าสุด${stats.recentlyApproved?.unpaidCount ? ` • รอจ่าย ${stats.recentlyApproved.unpaidCount} รายการ` : ''}`,
      icon: <Sparkles className="h-5 w-5 text-sky-600" />,
      bg: 'bg-sky-50',
      href: '/dashboard/reports/contractor-cycle',
    },
    {
      title: 'ต้องตรวจสอบ',
      value: stats.foremanQuality?.summary?.stale_requests || 0,
      hint: 'คำขอที่รอเกิน 3 วัน',
      icon: <AlertTriangle className="h-5 w-5 text-amber-600" />,
      bg: 'bg-amber-50',
      href: '/dashboard/billing',
    },
  ]

  return (
    <div className="space-y-8">
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
            <Card className="flex h-full min-h-[132px] flex-col p-4 transition-shadow group-hover:shadow-md group-hover:border-slate-300">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{kpi.title}</p>
                <div className={`rounded-lg p-2 ${kpi.bg}`}>{kpi.icon}</div>
              </div>
              <p className="mt-1 text-xl font-semibold text-slate-900">{kpi.value}</p>
              <p className="mt-1 text-xs text-slate-500">{kpi.hint}</p>
            </Card>
          </Link>
        ))}
      </div>

      {workRequestCounts && (
        <Link href="/dashboard/sales-requests" className="group block">
          <Card className="flex items-center justify-between gap-4 p-4 transition-shadow group-hover:shadow-md group-hover:border-slate-300">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-violet-50 p-2">
                <ClipboardCheck className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">คำขอจากฝ่ายขาย</p>
                <p className="text-xs text-slate-500">งานเพิ่มลูกค้า แก้ defect และคำขออื่นๆ ที่รอหน่วยงานก่อสร้าง</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <div className="text-center">
                <p className="text-xl font-semibold text-slate-900">{workRequestCounts.newCount}</p>
                <p className="text-xs text-slate-500">ใหม่</p>
              </div>
              <div className="text-center">
                <p className={`text-xl font-semibold ${workRequestCounts.overdueCount > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                  {workRequestCounts.overdueCount}
                </p>
                <p className="text-xs text-slate-500">เกินกำหนด</p>
              </div>
            </div>
          </Card>
        </Link>
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
                    <div className="h-2 rounded-full bg-slate-900" style={{ width: `${Math.max(4, project.completion_rate)}%` }} />
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
                <ShieldAlert className="h-5 w-5 text-amber-600" />
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
    </div>
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
