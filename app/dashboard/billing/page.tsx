'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Eye, Edit } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Badge, statusTone } from '@/components/ui/Badge'
import { Button, ButtonLink } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { getBillings } from '@/actions/billing-actions'
import BillingModal from '@/components/billings/BillingModal'
import { formatCurrency } from '@/lib/currency'
import NoticeBanner, { type NoticeTone } from '@/components/ui/NoticeBanner'
import PageLoading from '@/components/ui/PageLoading'

type BillingListItem = Awaited<ReturnType<typeof getBillings>>[number]
type BillingJobLine = NonNullable<BillingListItem['billing_jobs']>[number]
type BillingAdjustmentLine = NonNullable<BillingListItem['billing_adjustments']>[number]

const statusLabels: Record<string, string> = {
  approved: 'อนุมัติแล้ว',
  pending_review: 'รอตรวจสอบ',
  rejected: 'ไม่อนุมัติ',
  draft: 'ฉบับร่าง',
}

const getStatusChip = (status?: string | null) => (
  <Badge tone={statusTone(status || '')} className="px-2 py-0.5 text-[11px] font-medium leading-4">
    {statusLabels[status || ''] || status}
  </Badge>
)

export default function BillingListPage() {
  const [billings, setBillings] = useState<BillingListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [selectedBillingId, setSelectedBillingId] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ tone: 'success' | 'error' | 'info' | 'warning'; message: string } | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
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

  const loadBillings = useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      const data = await getBillings()
      setBillings(data)
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'โหลดรายการไม่สำเร็จ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBillings()
  }, [loadBillings])

  // Refetch when returning to the tab so PMs see new foreman submissions without a full reload.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadBillings()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadBillings])

  const handleRowClick = (bill: BillingListItem) => {
    if (bill.status === 'pending_review') {
      router.push(`/dashboard/billing/${bill.id}/review`)
    } else {
      setSelectedBillingId(bill.id)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="รายการเบิกจ่ายงวดงาน"
        subtitle="จัดการใบเบิกงวดงานหลักและงานเพิ่ม (DC) พร้อมติดตามสถานะอนุมัติ"
        actions={
          <>
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

      <Card className="p-4 bg-slate-50/60 border-slate-200">
        {loading ? (
          <PageLoading label="กำลังโหลดรายการเบิกจ่าย..." />
        ) : billings.length === 0 && listError ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-slate-600">ไม่สามารถโหลดรายการได้</p>
            <Button type="button" size="sm" onClick={() => void loadBillings()}>
              ลองโหลดใหม่
            </Button>
          </div>
        ) : billings.length === 0 ? (
          <div className="p-12 text-center text-slate-400">ยังไม่มีเอกสารเบิกจ่าย</div>
        ) : (
          <div className="space-y-3">
            {billings.map((bill) => (
              <div
                key={bill.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow cursor-pointer transition"
                onClick={() => handleRowClick(bill)}
              >
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[130px_140px_150px_1fr_150px_120px_56px]">
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
                  <div className="flex lg:justify-center">{getStatusChip(bill.status)}</div>
                  <div className="flex lg:justify-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRowClick(bill)
                      }}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
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
        onDeleted={loadBillings}
        onStatus={(status) => setFlash(status)}
      />
    </div>
  )
}
