'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getBillingsByCreator, deleteBilling } from '@/actions/billing-actions'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { EmptyState } from '@/components/ui/EmptyState'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Loader2, Trash2, Pencil, Search } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import { BILLING_STATUS_LABEL, BILLING_STATUS_TONE } from '@/lib/status-labels'
import { useDepartment } from '@/components/layout/DepartmentContext'

type Billing = Awaited<ReturnType<typeof getBillingsByCreator>>[number]

const getStatusChip = (status: string) => {
  const key = status as keyof typeof BILLING_STATUS_LABEL
  return (
    <Badge tone={BILLING_STATUS_TONE[key] || 'neutral'} className="px-2 py-0.5 text-[11px] font-medium leading-4">
      {BILLING_STATUS_LABEL[key] || status}
    </Badge>
  )
}

type Tab = 'pending_review' | 'rejected' | 'approved'

const TABS: { key: Tab; label: string }[] = [
  { key: 'pending_review', label: BILLING_STATUS_LABEL.pending_review },
  { key: 'rejected', label: BILLING_STATUS_LABEL.rejected },
  { key: 'approved', label: BILLING_STATUS_LABEL.approved },
]

export default function ForemanHistoryPageClient({
  initialBillings,
  initialError,
}: {
  initialBillings: Billing[]
  initialError?: string | null
}) {
  const router = useRouter()
  const { theme } = useDepartment()
  const [billings, setBillings] = useState<Billing[]>(initialBillings)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(initialError ?? null)
  const [tab, setTab] = useState<Tab>('pending_review')
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await getBillingsByCreator()
      setBillings(data)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'โหลดรายการไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial data already arrived as a prop from the server - only refetch
  // when the tab regains focus (foreman may have background tabs stale for a while).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  const getPlotLabel = (bill: Billing) => {
    const baseProject = bill.projects?.name || '-'
    const jobPlots = Array.from(
      new Set((bill.billing_jobs || []).map((j) => j.job_assignments?.plots?.name).filter(Boolean))
    ) as string[]
    if (bill.plots?.name) return `${baseProject} • แปลง ${bill.plots.name}`
    if (jobPlots.length > 0) {
      const preview = jobPlots.slice(0, 2).join(', ')
      const suffix = jobPlots.length > 2 ? ` +${jobPlots.length - 2}` : ''
      return `${baseProject} • แปลง ${preview}${suffix}`
    }
    return baseProject
  }

  const getBriefJobLines = (bill: Billing) => {
    const mainLines = (bill.billing_jobs || []).map((job) => {
      const name = job.job_assignments?.boq_master?.item_name || 'งานหลัก'
      const plot = job.job_assignments?.plots?.name
      return plot ? `${name} • แปลง ${plot}` : name
    })
    const adjLines = (bill.billing_adjustments || []).map((adj) => {
      const prefix = adj.type === 'deduction' ? 'หัก' : 'เพิ่ม'
      return `${prefix}: ${adj.description || '-'}`
    })
    return [...mainLines, ...adjLines].slice(0, 3)
  }

  const getJobTypeLabel = (bill: Billing) => {
    const hasMain = (bill.billing_jobs || []).length > 0
    const hasAdd = (bill.billing_adjustments || []).some((a) => a.type === 'addition')
    const hasDeduct = (bill.billing_adjustments || []).some((a) => a.type === 'deduction')
    const tags: string[] = []
    if (hasMain) tags.push('งานหลัก')
    if (hasAdd) tags.push('งานเพิ่ม')
    if (hasDeduct) tags.push('งานหัก')
    if (tags.length === 0 && bill.type === 'extra_work') return 'DC'
    return tags.join(' / ') || '-'
  }

  const handleEdit = (bill: Billing) => {
    const target = bill.type === 'extra_work'
      ? `/dashboard/foreman/create-dc?editId=${bill.id}`
      : `/dashboard/foreman/request?editId=${bill.id}`
    router.push(target)
  }

  const handleDelete = async () => {
    if (!deleteTargetId) return
    setIsDeleting(true)
    const result = await deleteBilling(deleteTargetId)
    setIsDeleting(false)
    setDeleteTargetId(null)
    if ('error' in result) {
      setLoadError(result.error)
      return
    }
    await load()
  }

  const q = search.trim().toLowerCase()
  const filteredBillings = billings.filter((bill) => {
    if (bill.status !== tab) return false
    if (!q) return true
    const haystack = `${bill.contractors?.name || ''} ${getPlotLabel(bill)} ${getBriefJobLines(bill).join(' ')}`.toLowerCase()
    return haystack.includes(q)
  })
  const tabCount = (key: Tab) => billings.filter((bill) => bill.status === key).length

  return (
    <PageContainer width="standard">
      <PageHeader
        title="ประวัติคำขอ"
        subtitle="รวมทุกคำขอที่คุณสร้างไว้"
        actions={
          <>
            <Button variant="secondary" onClick={() => router.push('/dashboard/foreman/create-progress')}>
              สร้างใบขอเบิกงวด
            </Button>
            <Button onClick={() => router.push('/dashboard/foreman/create-dc')}>
              สร้างงานเพิ่ม (DC)
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="flex">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-semibold transition ${
                tab === t.key ? 'border-b-2 ' + theme.tab : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label} <span className="text-xs font-normal text-slate-500">({tabCount(t.key)})</span>
            </button>
          ))}
        </div>
        <div className="relative mb-2 w-full max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9"
            placeholder="ค้นหาผู้รับเหมา / แปลง / งาน"
          />
        </div>
      </div>

      <Card className="p-4 bg-slate-50/60 border-slate-200">
        {loading ? (
          <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto"/></div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-red-600">{loadError}</p>
            <Button type="button" onClick={() => void load()}>
              ลองโหลดใหม่
            </Button>
          </div>
        ) : filteredBillings.length === 0 ? (
          <EmptyState
            variant={search ? 'no-results' : 'empty'}
            title={search ? 'ไม่พบคำขอที่ค้นหา' : 'ไม่มีคำขอในหมวดนี้'}
            description={search ? 'ลองเปลี่ยนคำค้นหา' : 'คำขอที่คุณสร้างจะแสดงตามสถานะที่นี่'}
          />
        ) : (
          <div className="space-y-3">
            {filteredBillings.map((bill) => (
              <div key={bill.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition-colors">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[130px_160px_1fr_150px_120px_130px]">
                  <div className="text-slate-500 text-sm">{new Date(bill.created_at || bill.billing_date || '').toLocaleDateString('th-TH')}</div>
                  <div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700">
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
                  <div className="text-right font-semibold text-emerald-600">฿{formatCurrency(bill.net_amount ?? 0)}</div>
                  <div className="flex flex-col items-start gap-1 lg:items-center">
                    {getStatusChip(bill.status || '')}
                    {/* What happens next, so the list says more than a status colour. */}
                    <span className="text-[11px] text-slate-500 lg:text-center">
                      {bill.status === 'pending_review'
                        ? 'รอ PM ตรวจสอบ'
                        : bill.status === 'rejected'
                          ? 'แก้ไขแล้วส่งใหม่ได้'
                          : bill.status === 'approved'
                            ? 'PM อนุมัติแล้ว รอบัญชีจ่าย'
                            : ''}
                    </span>
                    {bill.status === 'rejected' && bill.review_note && (
                      <div className="text-[11px] text-red-600 lg:text-center" title={bill.review_note}>
                        {bill.review_note}
                      </div>
                    )}
                  </div>
                  <div className="flex lg:justify-center">
                    {bill.status === 'pending_review' ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleEdit(bill)} aria-label="แก้ไขคำขอ" title="แก้ไข" className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"><Pencil className="h-4 w-4"/></button>
                        <button onClick={() => setDeleteTargetId(bill.id)} aria-label="ลบคำขอ" title="ลบ" className="flex h-11 w-11 items-center justify-center rounded-lg border border-red-100 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4"/></button>
                      </div>
                    ) : bill.status === 'rejected' ? (
                      <Button size="sm" variant="secondary" onClick={() => handleEdit(bill)}>
                        <Pencil className="h-3.5 w-3.5" /> แก้ไขแล้วส่งใหม่
                      </Button>
                    ) : <span className="text-xs text-slate-500">-</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        isOpen={deleteTargetId !== null}
        title="ลบคำขอ"
        message="ต้องการลบคำขอนี้ใช่หรือไม่?"
        confirmLabel={isDeleting ? 'กำลังลบ...' : 'ลบ'}
        cancelLabel="ยกเลิก"
        tone="danger"
        busy={isDeleting}
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={handleDelete}
      />
    </PageContainer>
  )
}
