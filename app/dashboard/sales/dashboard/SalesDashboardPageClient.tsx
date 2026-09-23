'use client'

import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Building2, CheckCircle2, Clock, Home, Wallet } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import { statusColorClasses } from '@/lib/sales/statusColors'
import RankedBarList from '@/components/sales/RankedBarList'
import type { getSalesBoardOptions } from '@/actions/sales-actions'
import type { SalesDashboardData } from '@/actions/sales-dashboard-actions'

type ProjectOption = Awaited<ReturnType<typeof getSalesBoardOptions>>['projects'][number]

function StatTile({
  icon: Icon,
  label,
  value,
  tone = 'slate',
}: {
  icon: typeof Building2
  label: string
  value: string
  tone?: 'slate' | 'emerald' | 'amber' | 'indigo' | 'red'
}) {
  const toneClasses: Record<string, string> = {
    slate: 'bg-slate-50 text-slate-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    red: 'bg-red-50 text-red-600',
  }
  return (
    <Card className="flex items-center gap-3 p-4">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneClasses[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs text-slate-500">{label}</p>
        <p className="truncate text-lg font-semibold text-slate-800">{value}</p>
      </div>
    </Card>
  )
}

export default function SalesDashboardPageClient({
  projects,
  projectId,
  data,
  initialError,
}: {
  projects: ProjectOption[]
  projectId: string | null
  data: SalesDashboardData | null
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  function handleProjectChange(next: string) {
    startTransition(() => {
      router.push(next ? `/dashboard/sales/dashboard?project=${next}` : '/dashboard/sales/dashboard')
    })
  }

  const t = data?.totals
  const p = data?.payments

  return (
    <div className="space-y-6">
      <PageHeader
        title="แดชบอร์ดขาย"
        subtitle="ภาพรวมยอดขาย สถานะแปลง และเงินที่เก็บได้"
        actions={
          <select
            value={projectId || ''}
            onChange={(e) => handleProjectChange(e.target.value)}
            disabled={isPending}
            className="min-w-[220px]"
          >
            <option value="">ทุกโครงการ</option>
            {projects.map((pr) => (
              <option key={pr.id} value={pr.id}>{pr.name}</option>
            ))}
          </select>
        }
      />

      {!data ? (
        <div className="py-12 text-center text-slate-400">โหลดข้อมูลไม่สำเร็จ</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <StatTile icon={Home} label="แปลงทั้งหมด" value={(t?.total_plots ?? 0).toLocaleString('th-TH')} />
            <StatTile icon={Building2} label="ว่าง" value={(t?.available_count ?? 0).toLocaleString('th-TH')} tone="slate" />
            <StatTile icon={Clock} label="กำลังดำเนินการ" value={(t?.in_progress_count ?? 0).toLocaleString('th-TH')} tone="amber" />
            <StatTile icon={CheckCircle2} label="ขายแล้ว" value={(t?.sold_count ?? 0).toLocaleString('th-TH')} tone="emerald" />
            <StatTile icon={Wallet} label="มูลค่าดีลรวม" value={`฿${formatCurrency(t?.total_deal_value ?? 0)}`} tone="indigo" />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-semibold text-slate-700">เงินที่เก็บได้</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">เก็บแล้ว</span>
                  <span className="font-semibold text-emerald-600">฿{formatCurrency(p?.collected ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">ค้างชำระ</span>
                  <span className="font-semibold text-slate-700">฿{formatCurrency(p?.outstanding ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="flex items-center gap-1.5 text-red-600">
                    <AlertTriangle className="h-4 w-4" /> เกินกำหนดชำระ
                  </span>
                  <span className="font-semibold text-red-600">
                    ฿{formatCurrency(p?.overdue_amount ?? 0)} ({(p?.overdue_count ?? 0).toLocaleString('th-TH')} รายการ)
                  </span>
                </div>
              </div>
            </Card>

            <div className="lg:col-span-2">
              <Card className="p-5">
                <h3 className="mb-4 text-sm font-semibold text-slate-700">แปลงตามสถานะ</h3>
                {data.byStatus.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">ยังไม่มีข้อมูล</p>
                ) : (
                  <div className="space-y-3">
                    {data.byStatus.map((row) => {
                      const c = statusColorClasses(row.status_color)
                      const max = Math.max(1, ...data.byStatus.map((r) => r.n))
                      return (
                        <div key={row.status_code ?? 'available'}>
                          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                            <span className="flex items-center gap-1.5 font-medium text-slate-700">
                              <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                              {row.status_label}
                            </span>
                            <span className="text-slate-500">
                              {row.n.toLocaleString('th-TH')} แปลง
                              {row.value > 0 && <span className="ml-2 text-slate-400">฿{formatCurrency(row.value)}</span>}
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full ${c.dot}`} style={{ width: `${Math.max(2, (row.n / max) * 100)}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {!projectId && (
              <RankedBarList
                title="ยอดขายตามโครงการ"
                items={data.byProject.map((row) => ({
                  key: row.project_name,
                  label: row.project_name,
                  metric: row.value,
                  secondary: `${row.sold}/${row.total} แปลง`,
                }))}
              />
            )}
            <RankedBarList
              title="ยอดขายตามแบบบ้าน"
              items={data.byModel.map((row) => ({
                key: row.house_model_name,
                label: row.house_model_name,
                metric: row.sold,
                secondary: `${row.sold}/${row.total} แปลง`,
              }))}
              defaultColorClass="bg-violet-500"
            />
            <RankedBarList
              title="อันดับพนักงานขาย"
              items={data.byRep.map((row) => ({
                key: row.rep_name,
                label: row.rep_name,
                metric: row.value,
                secondary: `${row.deals} ดีล · ฿${formatCurrency(row.value)}`,
              }))}
              defaultColorClass="bg-sky-500"
            />
          </div>
        </>
      )}
    </div>
  )
}
