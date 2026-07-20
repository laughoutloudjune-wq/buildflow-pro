import Link from 'next/link'
import { Activity, AlertTriangle, Building2, CheckCircle2, Clock3, Home, ShieldAlert, Sparkles, TrendingUp, Wallet } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { ButtonLink } from '@/components/ui/Button'
import { getDashboardStats } from '@/actions/dashboard-actions'
import { formatCurrency } from '@/lib/currency'

function riskLevelTone(level: string) {
  if (level === 'high') return 'danger'
  if (level === 'medium') return 'warning'
  return 'success'
}

export default async function DashboardPage() {
  const stats = await getDashboardStats()

  const kpis = [
    {
      title: 'Total Projects',
      value: stats.projectCount,
      hint: `${stats.plotCount} plots`,
      icon: <Building2 className="h-5 w-5 text-blue-600" />,
      bg: 'bg-blue-50',
      href: '/dashboard/projects',
    },
    {
      title: 'Active Jobs',
      value: stats.activeJobs,
      hint: `${stats.pendingApprovals} pending PM approvals`,
      icon: <Activity className="h-5 w-5 text-indigo-600" />,
      bg: 'bg-indigo-50',
      href: '/dashboard/billing',
    },
    {
      title: 'Paid Out',
      value: `THB ${formatCurrency(stats.totalPaid)}`,
      hint: 'From posted payments',
      icon: <Wallet className="h-5 w-5 text-emerald-600" />,
      bg: 'bg-emerald-50',
      href: '/dashboard/reports/house-history',
    },
    {
      title: 'Approved This Month',
      value: `THB ${formatCurrency(stats.approvedThisMonth || 0)}`,
      hint: 'Approved billing net amount',
      icon: <TrendingUp className="h-5 w-5 text-teal-600" />,
      bg: 'bg-teal-50',
      href: '/dashboard/reports/contractor-cycle',
    },
    {
      title: 'Recently Approved',
      value: stats.recentlyApproved?.count || 0,
      hint: `THB ${formatCurrency(stats.recentlyApproved?.amount || 0)} • last 7 days${stats.recentlyApproved?.unpaidCount ? ` • ${stats.recentlyApproved.unpaidCount} awaiting payout` : ''}`,
      icon: <Sparkles className="h-5 w-5 text-sky-600" />,
      bg: 'bg-sky-50',
      href: '/dashboard/reports/contractor-cycle',
    },
    {
      title: 'Quality Alerts',
      value: stats.foremanQuality?.summary?.stale_requests || 0,
      hint: 'Requests waiting > 3 days',
      icon: <AlertTriangle className="h-5 w-5 text-amber-600" />,
      bg: 'bg-amber-50',
      href: '/dashboard/billing',
    },
  ]

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard Overview"
        subtitle="KPI, risk, quality, and current workflow activity."
        actions={
          <>
            <ButtonLink variant="secondary" href="/dashboard/billing">Open PM Queue</ButtonLink>
            <ButtonLink href="/dashboard/reports/contractor-cycle">Open Contractor Cycle</ButtonLink>
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <Link key={kpi.title} href={kpi.href} className="group block">
            <Card className="p-4 transition-shadow group-hover:shadow-md group-hover:border-slate-300">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{kpi.title}</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-900">{kpi.value}</p>
                  <p className="mt-1 text-xs text-slate-500">{kpi.hint}</p>
                </div>
                <div className={`rounded-lg p-2 ${kpi.bg}`}>{kpi.icon}</div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

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
                <span>Completion</span>
                <span>{project.completion_rate}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-slate-900" style={{ width: `${Math.max(4, project.completion_rate)}%` }} />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-slate-500">Plots</p>
                <p className="font-semibold text-slate-900">{project.total_plots}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-slate-500">Jobs</p>
                <p className="font-semibold text-slate-900">{project.completed_jobs}/{project.total_jobs}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-slate-500">Pending Bills</p>
                <p className="font-semibold text-slate-900">{project.pending_bills}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <p className="text-slate-500">Approved Value</p>
                <p className="font-semibold text-slate-900">THB {formatCurrency(project.approved_value || 0)}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Foreman Quality Signals</h2>
            <ShieldAlert className="h-5 w-5 text-amber-600" />
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <MetricTile label="Submissions" value={stats.foremanQuality?.summary?.total_submissions || 0} />
            <MetricTile label="Pending Review" value={stats.foremanQuality?.summary?.pending_review || 0} />
            <MetricTile label="Stale" value={stats.foremanQuality?.summary?.stale_requests || 0} />
            <MetricTile label="Reject 30d" value={`${stats.foremanQuality?.summary?.rejection_rate_30d || 0}%`} />
          </div>

          <div className="space-y-2">
            {(stats.foremanQuality?.byForeman || []).map((f: any) => (
              <div key={f.user_id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-slate-900">{f.name}</p>
                  <span className="text-xs text-slate-500">Avg THB {formatCurrency(f.avg_request_value || 0)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-600">
                  <span>Submitted {f.submitted}</span>
                  <span>Approved {f.approved}</span>
                  <span>Rejected {f.rejected}</span>
                  <span>Pending {f.pending}</span>
                  <span>Stale {f.stale_pending}</span>
                </div>
              </div>
            ))}
            {(stats.foremanQuality?.byForeman || []).length === 0 && (
              <p className="text-sm text-slate-500">No foreman activity yet.</p>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Contractors Risk Panel</h2>
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
                  <span>Pending: {c.pending_count}</span>
                  <span>Overdue: {c.overdue_pending}</span>
                  <span>Rejected 30d: {c.rejected_30d}</span>
                  <span>Pending THB {formatCurrency(c.pending_amount || 0)}</span>
                </div>
              </div>
            ))}
            {(stats.contractorRisk || []).length === 0 && (
              <p className="text-sm text-slate-500">No contractor risk signals yet.</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Recent Activity Timeline</h2>
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
                  <span className="font-semibold text-slate-700">THB {formatCurrency(item.amount || 0)}</span>
                </div>
              </div>
            </div>
          ))}
          {(stats.recentTimeline || []).length === 0 && (
            <p className="text-sm text-slate-500">No recent activity.</p>
          )}
        </div>
      </Card>
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
