'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Eye, Edit, Loader2, Printer } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { PageToolbar } from '@/components/ui/PageToolbar'
import { EmptyState } from '@/components/ui/EmptyState'
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

      <Card className="p-4 bg-slate-50/60 border-slate-200">
        {billings.length === 0 && listError ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-slate-600">ไม่สามารถโหลดรายการได้</p>
            <Button type="button" size="sm" onClick={refresh} disabled={isRefreshing}>
              {isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'ลองโหลดใหม่'}
            </Button>
          </div>
        ) : billings.length === 0 ? (
          <EmptyState title="ยังไม่มีเอกสารเบิกจ่าย" description="ใบเบิกงวดงานและงานเพิ่ม (DC) ที่สร้างแล้วจะแสดงที่นี่" />
        ) : filteredBillings.length === 0 ? (
          <EmptyState variant="no-results" title="ไม่พบรายการที่ตรงกับตัวกรอง" description="ลองเปลี่ยนหรือล้างตัวกรอง" />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                />
                เลือกทั้งหมดที่แสดง ({filteredBillings.length})
              </label>
              {selectedVisible.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                >
                  เลือกแล้ว {selectedVisible.length} • ล้างที่เลือก
                </button>
              )}
            </div>
            {filteredBillings.map((bill) => (
              <div
                key={bill.id}
                className={`flex gap-3 rounded-xl border bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow cursor-pointer transition ${
                  selectedIds.has(bill.id) ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-slate-200'
                }`}
                onClick={() => handleRowClick(bill)}
              >
                <div className="flex items-start pt-1" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    aria-label={`เลือกใบเบิก #${bill.doc_no}`}
                    checked={selectedIds.has(bill.id)}
                    onChange={() => toggleSelected(bill.id)}
                  />
                </div>
                <div className="min-w-0 flex-1 grid grid-cols-1 gap-3 lg:grid-cols-[130px_140px_150px_1fr_150px_120px_56px]">
                  <div className="flex items-start">
                    <div className="font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-md w-fit text-xs">
                      #{bill.doc_no?.toString().padStart(4, '0')}
                    </div>
                  </div>
                  <div className="text-slate-600 text-sm">
                    {bill.billing_date ? new Date(bill.billing_date).toLocaleDateString('th-TH') : '-'}
                  </div>
                  <div>
                    <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                      {getJobTypeLabel(bill)}
                    </span>
                  </div>
                  <div>
                    <div className="font-semibold text-slate-800">{bill.contractors?.name}</div>
                    <div className="text-xs text-slate-500">{getPlotLabel(bill)}</div>
                    <div className="mt-1 space-y-0.5 text-[11px] text-slate-600 leading-4">
                      {getBriefJobLines(bill).map((line: string, idx: number) => (
                        <div key={`${bill.id}-brief-${idx}`} className="truncate">{line}</div>
                      ))}
                    </div>
                  </div>
                  <div className="text-right font-bold text-emerald-600">฿{formatCurrency(bill.net_amount)}</div>
                  <div className="flex flex-col items-start gap-1 lg:items-center">
                    {getStatusChip(bill.status)}
                    {bill.status === 'rejected' && bill.review_note && (
                      <div className="text-[11px] text-red-600 lg:text-center" title={bill.review_note}>
                        {bill.review_note}
                      </div>
                    )}
                  </div>
                  <div className="flex lg:justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRowClick(bill)
                      }}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                    >
                      {bill.status === 'pending_review' ? <Edit className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <BillingModal
        billingId={selectedBillingId}
        onClose={() => setSelectedBillingId(null)}
        onDeleted={refresh}
        onStatus={(status) => setFlash(status)}
      />
    </PageContainer>
  )
}
