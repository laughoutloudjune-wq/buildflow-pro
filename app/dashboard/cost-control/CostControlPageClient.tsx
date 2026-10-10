'use client'

import { useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Coins, Info, Loader2, MapPinOff, PackageCheck, Wallet } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { formatCurrency } from '@/lib/currency'
import ScopePicker, { type CostControlOptions } from '@/components/cost-control/ScopePicker'
import QtyControlTab from '@/components/cost-control/QtyControlTab'
import MaterialCostTab from '@/components/cost-control/MaterialCostTab'
import LaborCostTab from '@/components/cost-control/LaborCostTab'
import { excessValue, rowStatus, type BoqControlOutsideBoqRow, type BoqControlRow, type BoqControlUnassignedRow, type ControlScope } from '@/lib/procurement/boqControl'
import type { getBoqControl } from '@/actions/procurement/boq-control'
import type { MaterialsSummaryRow } from '@/actions/procurement/materials-summary'
import type { LaborLedgerEntry } from '@/lib/labor-budget'
import { useDepartment } from '@/components/layout/DepartmentContext'

export type CostControlTab = 'qty' | 'material-cost' | 'labor-cost'

const TAB_LABEL: Record<CostControlTab, string> = {
  qty: 'คุมปริมาณวัสดุ',
  'material-cost': 'ต้นทุนวัสดุ',
  'labor-cost': 'ต้นทุนค่าแรง',
}

type Props = {
  options: CostControlOptions
  scope: ControlScope
  tab: CostControlTab
  canSeeLabor: boolean
  boqControl: Awaited<ReturnType<typeof getBoqControl>>
  materialsSummary: MaterialsSummaryRow[]
  laborEntries: LaborLedgerEntry[]
  initialError?: string | null
}

function buildUrl(scope: ControlScope, tab: CostControlTab): string {
  const params = new URLSearchParams()
  if (scope.projectId) params.set('project', scope.projectId)
  if (scope.plotIds && scope.plotIds.length > 0) params.set('plots', scope.plotIds.join(','))
  else if (scope.plotGroupId) params.set('group', scope.plotGroupId)
  if (tab !== 'qty') params.set('tab', tab)
  const qs = params.toString()
  return qs ? `/dashboard/cost-control?${qs}` : '/dashboard/cost-control'
}

/**
 * The whole page is URL-driven (BOQ_CONTROL_PLAN.md 8.5/8.7): every scope
 * or tab change is a navigation, which re-runs the server page component
 * and hands this client component fresh props - so there's no local copy
 * of server data to keep in sync, only the pending-navigation spinner.
 */
export default function CostControlPageClient({
  options,
  scope,
  tab,
  canSeeLabor,
  boqControl,
  materialsSummary,
  laborEntries,
  initialError,
}: Props) {
  const router = useRouter()
  const { theme } = useDepartment()
  const toast = useToast()
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  function navigate(nextScope: ControlScope, nextTab: CostControlTab) {
    startTransition(() => {
      router.push(buildUrl(nextScope, nextTab))
    })
  }

  const rows: BoqControlRow[] = boqControl.rows
  const unassigned: BoqControlUnassignedRow[] = boqControl.unassigned
  const outsideBoq: BoqControlOutsideBoqRow[] = boqControl.outsideBoq

  const overRows = rows.filter((r) => rowStatus(r) === 'over')
  const overValue = overRows.reduce((sum, r) => sum + excessValue(r), 0)
  const materialsReceivedTotal = materialsSummary.reduce((sum, r) => sum + r.received_value, 0)
  const laborApprovedTotal = laborEntries.reduce((sum, e) => sum + e.approved, 0)
  const unassignedTotal = unassigned.reduce((sum, u) => sum + u.orderedValue, 0)

  const tiles = [
    { icon: AlertTriangle, label: 'รายการเกิน BOQ', value: `${overRows.length} รายการ`, tone: overRows.length > 0 ? 'text-red-600' : 'text-slate-800' },
    { icon: Coins, label: 'มูลค่าส่วนเกิน', value: `฿${formatCurrency(overValue)}`, tone: overValue > 0 ? 'text-red-600' : 'text-slate-800' },
    { icon: PackageCheck, label: 'วัสดุที่รับแล้ว', value: `฿${formatCurrency(materialsReceivedTotal)}`, tone: 'text-slate-800' },
    { icon: Wallet, label: 'ค่าแรงที่อนุมัติแล้ว', value: `฿${formatCurrency(laborApprovedTotal)}`, tone: 'text-slate-800' },
    { icon: MapPinOff, label: 'ยังไม่ระบุแปลง', value: `฿${formatCurrency(unassignedTotal)}`, tone: 'text-slate-500' },
  ]

  const visibleTabs: CostControlTab[] = canSeeLabor ? ['qty', 'material-cost', 'labor-cost'] : ['qty', 'material-cost']

  return (
    <PageContainer width="wide">
      <PageHeader title="ควบคุมต้นทุน" subtitle="เทียบ BOQ กับของที่ซื้อจริง และรายงานต้นทุนโครงการในที่เดียว" />

      <Card className="p-4">
        <ScopePicker options={options} scope={scope} onChange={(next) => navigate(next, tab)} />
      </Card>

      {!scope.projectId ? (
        <Card>
          <EmptyState title="เลือกโครงการเพื่อดูข้อมูล" description="เลือกโครงการ (และกลุ่มแปลงหรือแปลง) ด้านบน แล้วระบบจะเทียบ BOQ กับของที่ซื้อจริง" />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {tiles.map((t) => (
              <Card key={t.label} className="p-3">
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </div>
                <div className={`mt-1 text-lg font-bold ${t.tone}`}>{t.value}</div>
              </Card>
            ))}
          </div>
          <p className="flex items-start gap-1.5 text-xs text-slate-600">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
            ยอดข้างต้นยังไม่รวมค่าใช้จ่ายอื่น (เช่น ค่าเช่ารถเครน ค่าขนส่ง) และค่าเครื่องจักร เนื่องจากระบบยังไม่มีการบันทึกส่วนนี้
          </p>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200">
            <div className="flex gap-2" role="tablist" aria-label="หมวดต้นทุน">
              {visibleTabs.map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => navigate(scope, t)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                    tab === t ? theme.tab : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {TAB_LABEL[t]}
                </button>
              ))}
            </div>
            {isPending && (
              <span className="mb-2 flex items-center gap-1.5 text-xs text-slate-500" role="status">
                <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด...
              </span>
            )}
          </div>

          {tab === 'qty' && <QtyControlTab scope={scope} rows={rows} unassigned={unassigned} outsideBoq={outsideBoq} />}
          {tab === 'material-cost' && <MaterialCostTab rows={materialsSummary} />}
          {tab === 'labor-cost' &&
            (canSeeLabor ? (
              <LaborCostTab entries={laborEntries} />
            ) : (
              <Card>
                <EmptyState title="ไม่มีสิทธิ์ดูต้นทุนค่าแรง" description="บทบาทของคุณไม่รวมข้อมูลค่าแรง หากต้องการดู ให้ติดต่อผู้ดูแลระบบ" />
              </Card>
            ))}

          <p className="text-xs text-slate-500">
            ต้องการหน้าจัดซื้อแบบเต็ม? ไปที่{' '}
            <Link href="/dashboard/procurement/orders" className="text-indigo-600 hover:underline">
              ใบสั่งซื้อ
            </Link>
          </p>
        </>
      )}
    </PageContainer>
  )
}
