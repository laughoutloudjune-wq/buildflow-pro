'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, ExternalLink, LayoutGrid, List, Loader2, Map as MapIcon, Pencil, Tag, Upload } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { EmptyState } from '@/components/ui/EmptyState'
import { TableFrame } from '@/components/ui/TableFrame'
import ActionMenu from '@/components/ui/ActionMenu'
import PlotQuickPanel from '@/components/plots/PlotQuickPanel'
import NoticeBanner from '@/components/ui/NoticeBanner'
import { useDepartment } from '@/components/layout/DepartmentContext'
import { useToast } from '@/components/ui/Toast'
import Modal from '@/components/ui/Modal'
import ScopePicker, { type CostControlOptions } from '@/components/cost-control/ScopePicker'
import SalesImportModal from '@/components/sales/SalesImportModal'
import SalesMapView from '@/components/sales/SalesMapView'
import type { ControlScope } from '@/lib/procurement/boqControl'
import { formatCurrency } from '@/lib/currency'
import { statusColorClasses } from '@/lib/sales/statusColors'
import { changeSaleStatus, type SaleStatus, type SalesBoardRow, type SitePlanData } from '@/actions/sales-actions'
import type { OverdueSalePayment } from '@/actions/sale-payments-actions'

export type SalesBoardView = 'cards' | 'table' | 'map'

const PAYMENT_KIND_LABEL: Record<string, string> = {
  booking: 'เงินจอง',
  contract: 'เงินทำสัญญา',
  down: 'เงินผ่อนดาวน์',
  transfer: 'เงินวันโอน',
  extra: 'เงินอื่นๆ',
}

type Props = {
  options: CostControlOptions
  scope: ControlScope
  view: SalesBoardView
  board: SalesBoardRow[]
  statuses: SaleStatus[]
  overduePayments: OverdueSalePayment[]
  sitePlanData: SitePlanData | null
  canEditSitePlan: boolean
  initialError?: string | null
}

function buildUrl(scope: ControlScope, view: SalesBoardView): string {
  const params = new URLSearchParams()
  if (scope.projectId) params.set('project', scope.projectId)
  if (scope.plotIds && scope.plotIds.length > 0) params.set('plots', scope.plotIds.join(','))
  else if (scope.plotGroupId) params.set('group', scope.plotGroupId)
  if (view !== 'map') params.set('view', view)
  const qs = params.toString()
  return qs ? `/dashboard/sales?${qs}` : '/dashboard/sales'
}

const MILESTONES: { key: keyof SalesBoardRow; label: string }[] = [
  { key: 'delivered_at', label: 'ส่งมอบ' },
  { key: 'transfer_at', label: 'โอนกรรมสิทธิ์' },
  { key: 'inspection_at', label: 'นัดตรวจบ้าน' },
  { key: 'contract_at', label: 'ทำสัญญา' },
  { key: 'booked_at', label: 'จอง' },
]

/** The most recent milestone this deal has reached, for the card's "next key
 * date" line - there's no separate "upcoming appointment" field, so the
 * latest date actually recorded is what's shown (SALES_MODULE_PLAN.md §8.2). */
function latestMilestone(row: SalesBoardRow): { label: string; date: string } | null {
  for (const m of MILESTONES) {
    const value = row[m.key] as string | null
    if (value) return { label: m.label, date: value }
  }
  return null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function isThisMonth(iso: string | null): boolean {
  if (!iso) return false
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

type EditTarget = { plotId: string; plotName: string }

export default function SalesBoardPageClient({
  options,
  scope,
  view,
  board,
  statuses,
  overduePayments,
  sitePlanData,
  canEditSitePlan,
  initialError,
}: Props) {
  const router = useRouter()
  const toast = useToast()
  const { theme } = useDepartment()
  const [isPending, startTransition] = useTransition()

  const [statusFilter, setStatusFilter] = useState('')
  const [repFilter, setRepFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [transferThisMonthOnly, setTransferThisMonthOnly] = useState(false)
  const [overdueDays, setOverdueDays] = useState('')

  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null)

  useEffect(() => {
    if (initialError) toast.error(initialError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialError])

  function navigate(nextScope: ControlScope, nextView: SalesBoardView) {
    startTransition(() => {
      router.push(buildUrl(nextScope, nextView))
    })
  }

  const salesReps = useMemo(
    () => Array.from(new Set(board.map((r) => r.sales_rep_name).filter((v): v is string => Boolean(v)))).sort(),
    [board]
  )
  const houseModels = useMemo(
    () => Array.from(new Set(board.map((r) => r.house_model_name).filter((v): v is string => Boolean(v)))).sort(),
    [board]
  )

  const filteredBoard = useMemo(() => {
    const overdueThreshold = overdueDays.trim() ? Number(overdueDays) : null
    return board.filter((row) => {
      if (statusFilter && row.status_code !== statusFilter) return false
      if (repFilter && row.sales_rep_name !== repFilter) return false
      if (modelFilter && row.house_model_name !== modelFilter) return false
      if (transferThisMonthOnly && !isThisMonth(row.transfer_at)) return false
      if (overdueThreshold !== null && Number.isFinite(overdueThreshold)) {
        const since = daysSince(row.status_updated_at)
        const isOpenDeal = row.sale_id && row.stage !== 'closed' && row.stage !== 'lost'
        if (!isOpenDeal || since === null || since < overdueThreshold) return false
      }
      return true
    })
  }, [board, statusFilter, repFilter, modelFilter, transferThisMonthOnly, overdueDays])

  const legendCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of board) counts.set(row.status_code, (counts.get(row.status_code) || 0) + 1)
    return counts
  }, [board])

  const grouped = useMemo(() => {
    const groups = new Map<string, { name: string; rows: SalesBoardRow[] }>()
    for (const row of filteredBoard) {
      const key = row.plot_group_id || '__none__'
      if (!groups.has(key)) groups.set(key, { name: row.plot_group_name || 'ไม่ระบุกลุ่ม', rows: [] })
      groups.get(key)!.rows.push(row)
    }
    return Array.from(groups.values())
  }, [filteredBoard])

  const selectedRow = selectedPlotId ? filteredBoard.find((r) => r.plot_id === selectedPlotId) ?? null : null
  const editingRow = editTarget ? board.find((r) => r.plot_id === editTarget.plotId) || null : null

  async function handleStatusSave(formData: FormData) {
    if (!editTarget) return
    setIsSaving(true)
    const res = await changeSaleStatus({
      plotId: editTarget.plotId,
      statusCode: String(formData.get('status_code') || ''),
      note: String(formData.get('note') || ''),
      customerId: editingRow?.customer_id || undefined,
      customerName: String(formData.get('customer_name') || ''),
      customerPhone: String(formData.get('customer_phone') || ''),
      salePrice: formData.get('sale_price') ? Number(formData.get('sale_price')) : undefined,
    })
    setIsSaving(false)

    if (!res.success) {
      toast.error(res.error || 'บันทึกไม่สำเร็จ')
      return
    }
    toast.success(`อัปเดตสถานะแปลง ${editTarget.plotName} แล้ว`)
    setEditTarget(null)
  }

  return (
    <PageContainer width="wide">
      {initialError ? <NoticeBanner tone="error" message={initialError} /> : null}

      <PageHeader
        title="ผังการขาย"
        subtitle="สถานะการขายของทุกแปลง เชื่อมกับความคืบหน้าก่อสร้างแบบเรียลไทม์"
        actions={
          <div className="flex items-center gap-2">
            {scope.projectId && (
              <Button type="button" variant="secondary" onClick={() => setIsImportOpen(true)}>
                <Upload className="h-4 w-4" /> นำเข้าข้อมูลเดิม
              </Button>
            )}
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => navigate(scope, 'cards')}
                aria-pressed={view === 'cards'}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === 'cards' ? theme.pill : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <LayoutGrid className="h-4 w-4" /> การ์ด
              </button>
              <button
                type="button"
                onClick={() => navigate(scope, 'table')}
                aria-pressed={view === 'table'}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === 'table' ? theme.pill : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <List className="h-4 w-4" /> ตาราง
              </button>
              <button
                type="button"
                onClick={() => navigate(scope, 'map')}
                aria-pressed={view === 'map'}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === 'map' ? theme.pill : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <MapIcon className="h-4 w-4" /> ผังโครงการ
              </button>
            </div>
          </div>
        }
      />

      {overduePayments.length > 0 && (
        <Card className="border-red-200 bg-red-50/60 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-700">
            <AlertTriangle className="h-4 w-4" /> ยอดค้างชำระเกินกำหนด ({overduePayments.length} รายการ)
          </div>
          <div className="space-y-1.5">
            {overduePayments.slice(0, 8).map((p) => (
              <Link
                key={p.id}
                href={`/dashboard/projects/${p.projectId}/${p.plotId}`}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg px-2 py-1 text-xs hover:bg-white/60"
              >
                <span className="text-slate-700">
                  <span className="font-medium">{p.plotName}</span> ({p.projectName}) — {p.customerName || 'ไม่ระบุลูกค้า'} —{' '}
                  {PAYMENT_KIND_LABEL[p.kind] || p.kind}
                  {p.installmentNo != null && ` งวดที่ ${p.installmentNo}`}
                </span>
                <span className="font-medium text-red-600">
                  ฿{formatCurrency(p.amountDue)} · เกิน {p.daysOverdue} วัน
                </span>
              </Link>
            ))}
            {overduePayments.length > 8 && (
              <p className="px-2 text-xs text-slate-500">และอีก {overduePayments.length - 8} รายการ</p>
            )}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <ScopePicker options={options} scope={scope} onChange={(next) => navigate(next, view)} />
      </Card>

      {isPending ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> กำลังโหลด...
        </div>
      ) : !scope.projectId ? (
        <Card>
          <EmptyState title="เลือกโครงการเพื่อดูผังการขาย" description="เลือกโครงการด้านบน แล้วสลับดูเป็นการ์ด ตาราง หรือผังโครงการ" />
        </Card>
      ) : (
        <>
          <Card className="flex flex-wrap items-center gap-2 p-4">
            <Tag className="h-4 w-4 text-slate-400" />
            {statuses.map((s) => {
              const c = statusColorClasses(s.color)
              const count = legendCounts.get(s.code) || 0
              return (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === s.code ? '' : s.code)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition ${c.chip} ${
                    statusFilter === s.code ? 'ring-2 ring-offset-1' : ''
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
                  {s.label}
                  <span className="opacity-70">({count})</span>
                </button>
              )
            })}
          </Card>

          <Card className="flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-[160px]">
              <label className="mb-1 block text-xs font-medium text-slate-500">พนักงานขาย</label>
              <select value={repFilter} onChange={(e) => setRepFilter(e.target.value)} className="w-full">
                <option value="">ทั้งหมด</option>
                {salesReps.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div className="min-w-[160px]">
              <label className="mb-1 block text-xs font-medium text-slate-500">แบบบ้าน</label>
              <select value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} className="w-full">
                <option value="">ทั้งหมด</option>
                {houseModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={transferThisMonthOnly}
                onChange={(e) => setTransferThisMonthOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              โอนเดือนนี้
            </label>
            <div className="min-w-[140px]">
              <label className="mb-1 block text-xs font-medium text-slate-500">ค้างเกิน (วัน)</label>
              <input
                type="number"
                min="0"
                value={overdueDays}
                onChange={(e) => setOverdueDays(e.target.value)}
                placeholder="เช่น 14"
                className="w-full"
              />
            </div>
            {(statusFilter || repFilter || modelFilter || transferThisMonthOnly || overdueDays) && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setStatusFilter('')
                  setRepFilter('')
                  setModelFilter('')
                  setTransferThisMonthOnly(false)
                  setOverdueDays('')
                }}
              >
                ล้างตัวกรอง
              </Button>
            )}
            <span className="ml-auto pb-2 text-xs text-slate-500">{filteredBoard.length} / {board.length} แปลง</span>
          </Card>

          <div className={selectedRow && view !== 'map' ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]' : ''}>
          <div className="min-w-0">
          {view === 'cards' ? (
            <div className="space-y-6">
              {grouped.map((group) => (
                <div key={group.name}>
                  <h3 className="mb-2 text-sm font-semibold text-slate-600">{group.name}</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {group.rows.map((row) => {
                      const c = statusColorClasses(row.status_color)
                      const milestone = latestMilestone(row)
                      return (
                        <Card
                          key={row.plot_id}
                          className={`cursor-pointer p-4 transition ${selectedPlotId === row.plot_id ? 'ring-2 ring-indigo-400' : 'hover:border-slate-300'}`}
                          onClick={() => setSelectedPlotId((cur) => (cur === row.plot_id ? null : row.plot_id))}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <Link
                                href={`/dashboard/projects/${scope.projectId}/${row.plot_id}`}
                                onClick={(e) => e.stopPropagation()}
                                className="font-bold text-slate-800 hover:text-indigo-600"
                              >
                                {row.plot_name}
                              </Link>
                              <div className="text-xs text-slate-500">{row.house_model_name || 'ไม่ระบุแบบ'}</div>
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>
                              <ActionMenu
                                label={`ตัวเลือกของแปลง ${row.plot_name}`}
                                items={[
                                  { label: 'เปลี่ยนสถานะ', icon: <Pencil />, onClick: () => setEditTarget({ plotId: row.plot_id, plotName: row.plot_name }) },
                                  { label: 'เปิดหน้ารายละเอียด', icon: <ExternalLink />, href: `/dashboard/projects/${scope.projectId}/${row.plot_id}` },
                                ]}
                              />
                            </div>
                          </div>

                          <div className="mt-2">
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${c.chip}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
                              {row.status_label}
                            </span>
                          </div>

                          <div className="mt-3 space-y-1 text-sm">
                            <div className="text-slate-600">{row.customer_name || '— ยังไม่มีลูกค้า —'}</div>
                            <div className="font-semibold text-slate-800">
                              {row.sale_price != null ? `฿${formatCurrency(row.sale_price)}` : row.list_price != null ? `ราคาตั้ง ฿${formatCurrency(row.list_price)}` : '—'}
                            </div>
                            {milestone && (
                              <div className="text-xs text-slate-500">{milestone.label}: {formatDate(milestone.date)}</div>
                            )}
                          </div>

                          <div className="mt-3">
                            <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                              <span>ก่อสร้าง</span>
                              <span>{row.jobs_done}/{row.jobs_total} งาน · {Math.round(row.progress_percent)}%</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full rounded-full ${theme.solid} transition-[width] duration-[220ms] ease-out`}
                                style={{ width: `${Math.max(0, Math.min(100, row.progress_percent))}%` }}
                              />
                            </div>
                          </div>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              ))}
              {filteredBoard.length === 0 && (
                <div className="py-12 text-center text-slate-500">ไม่พบแปลงตามตัวกรองนี้</div>
              )}
            </div>
          ) : view === 'table' ? (
            <TableFrame>
              <table>
                <thead>
                  <tr>
                    <th>แปลง</th>
                    <th>กลุ่ม</th>
                    <th>แบบบ้าน</th>
                    <th>สถานะ</th>
                    <th>ลูกค้า</th>
                    <th>พนักงานขาย</th>
                    <th className="text-right">ราคาขาย</th>
                    <th className="text-right">ก่อสร้าง</th>
                    <th className="w-12">
                      <span className="sr-only">ตัวเลือก</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBoard.map((row) => {
                    const c = statusColorClasses(row.status_color)
                    return (
                      <tr
                        key={row.plot_id}
                        onClick={() => setSelectedPlotId((cur) => (cur === row.plot_id ? null : row.plot_id))}
                        className={`cursor-pointer ${selectedPlotId === row.plot_id ? 'bg-indigo-50/60' : ''}`}
                        aria-selected={selectedPlotId === row.plot_id}
                      >
                        <td>
                          <Link
                            href={`/dashboard/projects/${scope.projectId}/${row.plot_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-medium text-slate-800 hover:text-indigo-600"
                          >
                            {row.plot_name}
                          </Link>
                        </td>
                        <td className="text-slate-500">{row.plot_group_name || '—'}</td>
                        <td className="text-slate-500">{row.house_model_name || '—'}</td>
                        <td>
                          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${c.chip}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
                            {row.status_label}
                          </span>
                        </td>
                        <td className="text-slate-600">{row.customer_name || '—'}</td>
                        <td className="text-slate-500">{row.sales_rep_name || '—'}</td>
                        <td className="whitespace-nowrap text-right font-medium tabular-nums text-slate-700">
                          {row.sale_price != null ? `฿${formatCurrency(row.sale_price)}` : '—'}
                        </td>
                        <td className="whitespace-nowrap text-right tabular-nums text-slate-500">
                          {row.jobs_done}/{row.jobs_total} · {Math.round(row.progress_percent)}%
                        </td>
                        <td onClick={(e) => e.stopPropagation()} className="text-center">
                          <ActionMenu
                            label={`ตัวเลือกของแปลง ${row.plot_name}`}
                            items={[
                              { label: 'เปลี่ยนสถานะ', icon: <Pencil />, onClick: () => setEditTarget({ plotId: row.plot_id, plotName: row.plot_name }) },
                              { label: 'เปิดหน้ารายละเอียด', icon: <ExternalLink />, href: `/dashboard/projects/${scope.projectId}/${row.plot_id}` },
                            ]}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filteredBoard.length === 0 && (
                <div className="py-12 text-center text-slate-500">ไม่พบแปลงตามตัวกรองนี้</div>
              )}
            </TableFrame>
          ) : sitePlanData ? (
            <SalesMapView
              projectId={scope.projectId}
              data={sitePlanData}
              canEdit={canEditSitePlan}
              visiblePlotIds={new Set(filteredBoard.map((r) => r.plot_id))}
            />
          ) : null}
          </div>
          {selectedRow && view !== 'map' && (
            <div className="xl:sticky xl:top-20">
              <PlotQuickPanel
                title={selectedRow.plot_name}
                subtitle={selectedRow.house_model_name || 'ไม่ระบุแบบ'}
                detailHref={`/dashboard/projects/${scope.projectId}/${selectedRow.plot_id}`}
                onClose={() => setSelectedPlotId(null)}
                summary={{
                  status: (
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${statusColorClasses(selectedRow.status_color).chip}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${statusColorClasses(selectedRow.status_color).dot}`} />
                      {selectedRow.status_label}
                    </span>
                  ),
                  lines: [
                    { label: 'ลูกค้า', value: selectedRow.customer_name || 'ยังไม่มีลูกค้า' },
                    { label: 'พนักงานขาย', value: selectedRow.sales_rep_name || '—' },
                    {
                      label: selectedRow.sale_price != null ? 'ราคาขาย' : 'ราคาตั้ง',
                      value:
                        selectedRow.sale_price != null
                          ? `฿${formatCurrency(selectedRow.sale_price)}`
                          : selectedRow.list_price != null
                            ? `฿${formatCurrency(selectedRow.list_price)}`
                            : '—',
                    },
                    ...(latestMilestone(selectedRow)
                      ? [{ label: latestMilestone(selectedRow)!.label, value: formatDate(latestMilestone(selectedRow)!.date) }]
                      : []),
                  ],
                  progressPercent: selectedRow.progress_percent,
                  progressLabel: `${selectedRow.jobs_done}/${selectedRow.jobs_total} งาน · ${Math.round(selectedRow.progress_percent)}%`,
                }}
                actions={
                  <Button type="button" size="sm" onClick={() => setEditTarget({ plotId: selectedRow.plot_id, plotName: selectedRow.plot_name })}>
                    <Pencil className="h-3.5 w-3.5" /> เปลี่ยนสถานะ
                  </Button>
                }
              />
            </div>
          )}
          </div>
        </>
      )}

      <Modal
        isOpen={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        title={editTarget ? `เปลี่ยนสถานะแปลง ${editTarget.plotName}` : ''}
      >
        <form action={handleStatusSave} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">สถานะ</label>
            <select name="status_code" required className="w-full" defaultValue={editingRow?.status_code || 'available'}>
              {statuses.map((s) => (
                <option key={s.code} value={s.code}>{s.label}</option>
              ))}
            </select>
          </div>
          {editingRow?.customer_id ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ลูกค้า</label>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {editingRow.customer_name}
              </div>
              <p className="mt-1 text-xs text-slate-500">แก้ไขข้อมูลลูกค้า (เบอร์โทร ที่อยู่ ฯลฯ) จะเพิ่มในหน้ารายละเอียดแปลง</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อลูกค้า</label>
                <input name="customer_name" className="w-full" placeholder="ยังไม่มีลูกค้า - กรอกเพื่อเพิ่มใหม่" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">เบอร์โทร</label>
                <input name="customer_phone" className="w-full" />
              </div>
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ราคาขาย (บาท)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              name="sale_price"
              className="w-full"
              defaultValue={editingRow?.sale_price ?? ''}
              placeholder={editingRow?.list_price ? `ราคาตั้ง ${formatCurrency(editingRow.list_price)}` : undefined}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">บันทึก / เหตุผล</label>
            <textarea name="note" required rows={2} className="w-full" placeholder="เช่น ลูกค้าจองผ่านหน้างาน วางเงินจอง 20,000" />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setEditTarget(null)}>ยกเลิก</Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              บันทึก
            </Button>
          </div>
        </form>
      </Modal>

      {scope.projectId && (
        <SalesImportModal
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          projectId={scope.projectId}
          onImported={() => router.refresh()}
        />
      )}
    </PageContainer>
  )
}
