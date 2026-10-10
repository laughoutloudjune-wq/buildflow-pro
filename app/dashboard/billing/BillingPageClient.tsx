'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Plus, Eye, Edit, Loader2, Printer } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { PageToolbar } from '@/components/ui/PageToolbar'
import { EmptyState } from '@/components/ui/EmptyState'
import { TableFrame } from '@/components/ui/TableFrame'
import Pagination, { usePagedRows } from '@/components/ui/Pagination'
import type { getBillings } from '@/actions/billing-actions'
import BillingModal from '@/components/billings/BillingModal'
import { formatCurrency } from '@/lib/currency'
import NoticeBanner, { type NoticeTone } from '@/components/ui/NoticeBanner'
import { BILLING_STATUS_LABEL, BILLING_STATUS_TONE } from '@/lib/status-labels'
import { useDepartment } from '@/components/layout/DepartmentContext'

type BillingListItem = Awaited<ReturnType<typeof getBillings>>[number]
type BillingJobLine = NonNullable<BillingListItem['billing_jobs']>[number]
type BillingAdjustmentLine = NonNullable<BillingListItem['billing_adjustments']>[number]

const statusLabels: Record<string, string> = BILLING_STATUS_LABEL

const getStatusChip = (status?: string | null) => {
  const key = status as keyof typeof BILLING_STATUS_LABEL
  return (
    <Badge tone={BILLING_STATUS_TONE[key] || statusTone(status || '')} className="px-2 py-0.5 text-[11px] font-medium leading-4">
      {statusLabels[status || ''] || status}
    </Badge>
  )
}

const PAGE_SIZE = 25

type BillingFilters = {
  month?: string
  projectId?: string
  contractorId?: string
  status?: string
}

export default function BillingPageClient({
  initialBillings,
  initialError,
  projects,
  contractors,
}: {
  initialBillings: BillingListItem[]
  initialError: string | null
  projects: Array<{ id: string; name: string }>
  contractors: Array<{ id: string; name: string }>
}) {
  const billings = initialBillings
  const [listError, setListError] = useState(initialError)
  const [selectedBillingId, setSelectedBillingId] = useState<string | null>(null)
  const [filters, setFilters] = useState<BillingFilters>({})
  const [flash, setFlash] = useState<{ tone: 'success' | 'error' | 'info' | 'warning'; message: string } | null>(null)
  const router = useRouter()
  const { theme } = useDepartment()
  const searchParams = useSearchParams()
  const [isRefreshing, startTransition] = useTransition()

  useEffect(() => {
    setListError(initialError)
  }, [initialError])

  const refresh = () => startTransition(() => router.refresh())

  const queryFlash = useMemo(() => {
    const message = searchParams.get('message')
    const type = searchParams.get('type')
    if (!message) return null
    const tone: NoticeTone = type === 'error' || type === 'warning' || type === 'info' ? type : 'success'
    return { tone, message }
  }, [searchParams])

  const getPlotLabel = (bill: BillingListItem) => {
    const baseProject = bill.projects?.name || '-'
    const jobPlots = Array.from(
      new Set((bill.billing_jobs || []).map((j: BillingJobLine) => j.job_assignments?.plots?.name).filter(Boolean))
    ) as string[]

    if (bill.plots?.name) return `${baseProject} • แปลง ${bill.plots.name}`
    if (jobPlots.length > 0) {
      const preview = jobPlots.slice(0, 2).join(', ')
      const suffix = jobPlots.length > 2 ? ` +${jobPlots.length - 2}` : ''
      return `${baseProject} • แปลง ${preview}${suffix}`
    }
    return baseProject
  }

  const getBriefJobLines = (bill: BillingListItem) => {
    const mainLines = (bill.billing_jobs || []).map((job: BillingJobLine) => {
      const name = job.job_assignments?.boq_master?.item_name || 'งานหลัก'
      const plot = job.job_assignments?.plots?.name
      return plot ? `${name} • แปลง ${plot}` : name
    })
    const adjLines = (bill.billing_adjustments || []).map((adj: BillingAdjustmentLine) => {
      const prefix = adj.type === 'deduction' ? 'หัก' : 'เพิ่ม'
      return `${prefix}: ${adj.description || '-'}`
    })
    return [...mainLines, ...adjLines].slice(0, 3)
  }

  const getJobTypeLabel = (bill: BillingListItem) => {
    const hasMain = (bill.billing_jobs || []).length > 0
    const hasAdd = (bill.billing_adjustments || []).some((a: BillingAdjustmentLine) => a.type === 'addition')
    const hasDeduct = (bill.billing_adjustments || []).some((a: BillingAdjustmentLine) => a.type === 'deduction')
    const tags: string[] = []
    if (hasMain) tags.push('งานหลัก')
    if (hasAdd) tags.push('งานเพิ่ม')
    if (hasDeduct) tags.push('งานหัก')
    if (tags.length === 0 && bill.type === 'extra_work') return 'DC'
    return tags.join(' / ') || '-'
  }

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredBillings = useMemo(() => {
    return billings.filter((bill) => {
      if (filters.projectId && bill.project_id !== filters.projectId) return false
      if (filters.contractorId && bill.contractor_id !== filters.contractorId) return false
      if (filters.month) {
        const billMonth = (bill.billing_date || '').slice(0, 7)
        if (billMonth !== filters.month) return false
      }
      if (filters.status && bill.status !== filters.status) return false
      return true
    })
  }, [billings, filters])

  // PM review queue first (oldest waiting at the top), everything else keeps its order.
  const sortedBillings = useMemo(
    () =>
      [...filteredBillings].sort((x, y) => {
        const rx = x.status === 'pending_review' ? 0 : 1
        const ry = y.status === 'pending_review' ? 0 : 1
        if (rx !== ry) return rx - ry
        if (rx === 0) return String(x.created_at || '').localeCompare(String(y.created_at || ''))
        return 0
      }),
    [filteredBillings]
  )
  const [page, setPage] = useState(1)
  // Back to page 1 whenever the filters change (adjusted during render, not in an effect).
  const filterKey = JSON.stringify(filters)
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setPage(1)
  }
  const { pageCount, currentPage, pagedRows } = usePagedRows(sortedBillings, page, PAGE_SIZE)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectedVisible = useMemo(
    () => filteredBillings.filter((b) => selectedIds.has(b.id)),
    [filteredBillings, selectedIds]
  )
  const allVisibleSelected = filteredBillings.length > 0 && selectedVisible.length === filteredBillings.length

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleSelectAllVisible = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) filteredBillings.forEach((b) => next.delete(b.id))
      else filteredBillings.forEach((b) => next.add(b.id))
      return next
    })

  const printHref = (() => {
    const params = new URLSearchParams()
    if (selectedVisible.length > 0) params.set('ids', selectedVisible.map((b) => b.id).join(','))
    if (filters.month) params.set('month', filters.month)
    if (filters.projectId) params.set('projectId', filters.projectId)
    if (filters.contractorId) params.set('contractorId', filters.contractorId)
    if (filters.status) params.set('status', filters.status)
    const qs = params.toString()
    return `/dashboard/billing/print${qs ? `?${qs}` : ''}`
  })()

  const handleRowClick = (bill: BillingListItem) => {
    if (bill.status === 'pending_review') {
      router.push(`/dashboard/billing/${bill.id}/review`)
    } else {
      setSelectedBillingId(bill.id)
    }
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title="รายการเบิกจ่ายงวดงาน"
        subtitle="จัดการใบเบิกงวดงานหลักและงานเพิ่ม (DC) พร้อมติดตามสถานะอนุมัติ"
        actions={
          <>
            {filteredBillings.length === 0 ? (
              <Button type="button" variant="secondary" disabled>
                <Printer className="h-4 w-4" /> พิมพ์ทั้งหมด (0)
              </Button>
            ) : (
              <ButtonLink href={printHref} target="_blank" rel="noopener" variant="secondary">
                <Printer className="h-4 w-4" />
                {selectedVisible.length > 0 ? `พิมพ์ที่เลือก (${selectedVisible.length})` : `พิมพ์ทั้งหมด (${filteredBillings.length})`}
              </ButtonLink>
            )}
            <ButtonLink href="/dashboard/foreman/create-progress" variant="secondary">
              <Plus className="h-4 w-4" /> สร้างใบเบิกงวดงาน
            </ButtonLink>
            <ButtonLink href="/dashboard/foreman/create-dc">
              <Plus className="h-4 w-4" /> สร้างใบเบิกงานเพิ่ม (DC)
            </ButtonLink>
          </>
        }
      />

      {queryFlash ? (
        <NoticeBanner tone={queryFlash.tone} message={queryFlash.message} onClose={() => router.replace('/dashboard/billing')} />
      ) : flash ? (
        <NoticeBanner tone={flash.tone} message={flash.message} onClose={() => setFlash(null)} />
      ) : null}

      {listError ? (
        <NoticeBanner
          tone="error"
          message={listError}
          onClose={billings.length > 0 ? () => setListError(null) : undefined}
        />
      ) : null}

      <div className="flex border-b border-slate-200">
        {[
          { key: undefined, label: 'ทั้งหมด' },
          { key: 'pending_review', label: BILLING_STATUS_LABEL.pending_review },
          { key: 'rejected', label: BILLING_STATUS_LABEL.rejected },
          { key: 'approved', label: BILLING_STATUS_LABEL.approved },
        ].map((t) => {
          const count = t.key ? billings.filter((b) => b.status === t.key).length : billings.length
          const isActive = (filters.status || undefined) === t.key
          return (
            <button
              key={t.label}
              type="button"
              onClick={() => setFilters((p) => ({ ...p, status: t.key }))}
              className={`px-4 py-2.5 text-sm font-semibold transition ${
                isActive ? 'border-b-2 ' + theme.tab : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label} <span className="text-xs font-normal text-slate-500">({count})</span>
            </button>
          )
        })}
      </div>

      <PageToolbar
        resultCount={filteredBillings.length}
        activeFilters={[
          ...(filters.month ? [{ label: `เดือน ${filters.month}`, onRemove: () => setFilters((p) => ({ ...p, month: undefined })) }] : []),
          ...(filters.projectId ? [{ label: projects.find((x) => x.id === filters.projectId)?.name ?? 'โครงการ', onRemove: () => setFilters((p) => ({ ...p, projectId: undefined })) }] : []),
          ...(filters.contractorId ? [{ label: contractors.find((x) => x.id === filters.contractorId)?.name ?? 'ผู้รับเหมา', onRemove: () => setFilters((p) => ({ ...p, contractorId: undefined })) }] : []),
          ...(filters.status ? [{ label: statusLabels[filters.status as keyof typeof statusLabels] ?? filters.status, onRemove: () => setFilters((p) => ({ ...p, status: undefined })) }] : []),
        ]}
        onReset={() => setFilters({})}
      >
        <input
          type="month"
          aria-label="เดือนของบิล"
          value={filters.month || ''}
          onChange={(e) => setFilters((p) => ({ ...p, month: e.target.value || undefined }))}
        />
        <select aria-label="โครงการ" className="min-w-[10rem]" value={filters.projectId || ''} onChange={(e) => setFilters((p) => ({ ...p, projectId: e.target.value || undefined }))}>
          <option value="">ทุกโครงการ</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select aria-label="ผู้รับเหมา" className="min-w-[10rem]" value={filters.contractorId || ''} onChange={(e) => setFilters((p) => ({ ...p, contractorId: e.target.value || undefined }))}>
          <option value="">ทุกผู้รับเหมา</option>
          {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="สถานะ" className="min-w-[10rem]" value={filters.status || ''} onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value || undefined }))}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </PageToolbar>

      {billings.length === 0 && listError ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-slate-600">ไม่สามารถโหลดรายการได้</p>
            <Button type="button" size="sm" onClick={refresh} disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'ลองโหลดใหม่'}
            </Button>
          </div>
        </Card>
      ) : billings.length === 0 ? (
        <Card>
          <EmptyState title="ยังไม่มีเอกสารเบิกจ่าย" description="ใบเบิกงวดงานและงานเพิ่ม (DC) ที่สร้างแล้วจะแสดงที่นี่" />
        </Card>
      ) : filteredBillings.length === 0 ? (
        <Card>
          <EmptyState variant="no-results" title="ไม่พบรายการที่ตรงกับตัวกรอง" description="ลองเปลี่ยนหรือล้างตัวกรอง" />
        </Card>
      ) : (
        <div className="space-y-2">
          {selectedVisible.length > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-indigo-50 px-4 py-2 text-sm text-indigo-900 ring-1 ring-inset ring-indigo-100">
              <span>เลือกแล้ว {selectedVisible.length} ใบ</span>
              <button type="button" onClick={() => setSelectedIds(new Set())} className="font-medium text-indigo-700 hover:text-indigo-900">
                ล้างที่เลือก
              </button>
            </div>
          )}
          <TableFrame>
            <table>
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      aria-label={`เลือกทั้งหมดที่แสดง (${filteredBillings.length})`}
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                    />
                  </th>
                  <th>เลขที่</th>
                  <th>วันที่</th>
                  <th>ประเภท</th>
                  <th>ผู้รับเหมา / รายการ</th>
                  <th className="text-right">ยอดสุทธิ</th>
                  <th>สถานะ</th>
                  <th className="w-12">
                    <span className="sr-only">การทำงาน</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagedRows
                  .map((bill) => {
                    const waitingDays =
                      bill.status === 'pending_review' && bill.created_at
                        ? Math.floor((Date.now() - new Date(bill.created_at).getTime()) / 86_400_000)
                        : null
                    const stale = waitingDays != null && waitingDays > 3
                    return (
                      <tr
                        key={bill.id}
                        onClick={() => handleRowClick(bill)}
                        className={`cursor-pointer align-top ${selectedIds.has(bill.id) ? 'bg-indigo-50/50' : ''}`}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            aria-label={`เลือกใบเบิก #${bill.doc_no}`}
                            checked={selectedIds.has(bill.id)}
                            onChange={() => toggleSelected(bill.id)}
                          />
                        </td>
                        <td>
                          <span className="whitespace-nowrap rounded-md border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
                            #{bill.doc_no?.toString().padStart(4, '0')}
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-slate-600">
                          {bill.billing_date ? new Date(bill.billing_date).toLocaleDateString('th-TH') : '-'}
                        </td>
                        <td>
                          <span className="inline-flex whitespace-nowrap rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                            {getJobTypeLabel(bill)}
                          </span>
                        </td>
                        <td className="min-w-[16rem]">
                          <div className="font-semibold text-slate-800">{bill.contractors?.name}</div>
                          <div className="text-xs text-slate-500">{getPlotLabel(bill)}</div>
                          <div className="mt-1 space-y-0.5 text-[11px] leading-4 text-slate-600">
                            {getBriefJobLines(bill).map((line: string, idx: number) => (
                              <div key={`${bill.id}-brief-${idx}`} className="max-w-xs truncate">{line}</div>
                            ))}
                          </div>
                        </td>
                        <td className="whitespace-nowrap text-right font-bold tabular-nums text-emerald-700">฿{formatCurrency(bill.net_amount)}</td>
                        <td>
                          <div className="flex flex-col items-start gap-1">
                            {getStatusChip(bill.status)}
                            {waitingDays != null && (
                              <span
                                className={`inline-flex items-center gap-1 text-[11px] ${
                                  stale ? 'rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800 ring-1 ring-inset ring-amber-200' : 'text-slate-500'
                                }`}
                              >
                                {stale && <AlertTriangle className="h-3 w-3" aria-hidden />}
                                รอมา {waitingDays} วัน
                              </span>
                            )}
                            {bill.status === 'rejected' && bill.review_note && (
                              <div className="max-w-[12rem] truncate text-[11px] text-red-700" title={bill.review_note}>
                                {bill.review_note}
                              </div>
                            )}
                          </div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleRowClick(bill)}
                            aria-label={bill.status === 'pending_review' ? `ตรวจสอบใบเบิก #${bill.doc_no}` : `ดูใบเบิก #${bill.doc_no}`}
                            title={bill.status === 'pending_review' ? 'ตรวจสอบ' : 'ดูรายละเอียด'}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-indigo-700"
                          >
                            {bill.status === 'pending_review' ? <Edit className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
            <Pagination currentPage={currentPage} pageCount={pageCount} onPageChange={setPage} />
          </TableFrame>
          <p className="px-1 text-xs text-slate-500">
            แสดง {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, sortedBillings.length)} จาก {sortedBillings.length} ใบ
          </p>
        </div>
      )}

      <BillingModal
        billingId={selectedBillingId}
        onClose={() => setSelectedBillingId(null)}
        onDeleted={refresh}
        onStatus={(status) => setFlash(status)}
      />
    </PageContainer>
  )
}
