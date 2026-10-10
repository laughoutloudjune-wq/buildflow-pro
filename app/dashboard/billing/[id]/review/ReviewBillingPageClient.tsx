'use client'

import { Fragment, useState, useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getBillingById, approveBilling, rejectBilling, deleteBilling, undoApproveBilling, getJobProgressHistory } from '@/actions/billing-actions'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Badge, statusTone } from '@/components/ui/Badge'
import { TableFrame } from '@/components/ui/TableFrame'
import { PageSection } from '@/components/ui/PageSection'
import { BILLING_STATUS_LABEL } from '@/lib/status-labels'
import AdjustmentLineItems from '@/components/billings/AdjustmentLineItems'
import { AlertTriangle, Edit, Trash2 } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import NoticeBanner from '@/components/ui/NoticeBanner'
import type { BillingAdjustmentForm, ProgressHistoryItem } from '@/lib/types/billing'

type BillingData = Awaited<ReturnType<typeof getBillingById>>
type Job = NonNullable<NonNullable<BillingData>['billing_jobs']>[number]
type Adjustment = BillingAdjustmentForm & { id?: string }

export default function ReviewBillingPageClient({
  id,
  initialBilling,
  initialJobs,
  initialAdjustments,
  initialBillingDate,
  initialWhtPercent,
  initialRetentionPercent,
  initialProgressHistoryByJob,
  initialError,
  canApprove,
}: {
  id: string
  initialBilling: BillingData
  initialJobs: Job[]
  initialAdjustments: Adjustment[]
  initialBillingDate: string
  initialWhtPercent: number
  initialRetentionPercent: number
  initialProgressHistoryByJob: Record<string, ProgressHistoryItem[]>
  initialError: string | null
  canApprove: boolean
}) {
  const router = useRouter()

  const [billing] = useState<BillingData>(initialBilling)
  const [jobs, setJobs] = useState<Job[]>(initialJobs)
  const [adjustments, setAdjustments] = useState<Adjustment[]>(initialAdjustments)
  const [billingDate, setBillingDate] = useState(initialBillingDate)
  const [whtPercent] = useState(initialWhtPercent)
  const [retentionPercent] = useState(initialRetentionPercent)
  const [progressHistoryByJob, setProgressHistoryByJob] = useState<Record<string, ProgressHistoryItem[]>>(initialProgressHistoryByJob)
  const [expandedHistoryRows, setExpandedHistoryRows] = useState<Set<string>>(new Set())

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(initialError)
  const [confirmAction, setConfirmAction] = useState<'delete' | 'undoApprove' | 'approve' | null>(null)
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState('')

  const isExtraWork = billing?.type === 'extra_work'
  const plotNames = useMemo(() => {
    if (!billing) return []
    if (billing.plots?.name) return [billing.plots.name]
    const names = (billing.billing_jobs || [])
      .map((job: Job) => job.job_assignments?.plots?.name)
      .filter((name: string | null | undefined): name is string => Boolean(name))
    return Array.from(new Set(names))
  }, [billing])

  const handleProgressChange = (jobAssignmentId: string, newProgress: number) => {
    if (newProgress < 0 || newProgress > 100) return

    setJobs((prevJobs) =>
      prevJobs.map((job) => {
        if (job.job_assignments.id === jobAssignmentId) {
          const totalBoq = job.totalBoq
          const paid = job.paid
          const newAmount = (totalBoq * newProgress) / 100 - paid
          return {
            ...job,
            progress_percent: newProgress,
            amount: Math.max(0, newAmount),
          }
        }
        return job
      })
    )
  }

  const handleAdjustmentChange = (index: number, field: keyof Adjustment, value: Adjustment[keyof Adjustment]) => {
    const next = [...adjustments]
    next[index] = { ...next[index], [field]: value }
    setAdjustments(next)
  }

  const addAdjustment = (type: 'addition' | 'deduction') => {
    setAdjustments([...adjustments, { type, description: '', plot_name: '', unit: 'หน่วย', quantity: 1, unit_price: 0 }])
  }

  const removeAdjustment = (index: number) => {
    setAdjustments(adjustments.filter((_, i) => i !== index))
  }

  const removeJob = (jobId: string) => {
    setJobs((prevJobs) => prevJobs.filter((job) => job.id !== jobId))
  }

  // WHT/retention are no longer set by the PM here — accounting applies them
  // later at pay-out time in the contractor-cycle page. Any nonzero percent
  // still carried on older bills is preserved through re-approval even though
  // it's no longer editable in this UI.
  const { totalWorkAmount, totalAddAmount, totalDeductAmount, grossAmount, netAmount } = useMemo(() => {
    const totalWorkAmount = jobs.reduce((sum, job) => sum + (job.amount || 0), 0)
    const totalAddAmount = adjustments.filter((adj) => adj.type === 'addition').reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)
    const totalDeductAmount = adjustments.filter((adj) => adj.type === 'deduction').reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)

    const retentionAmount = totalWorkAmount * (retentionPercent / 100)
    const grossAmount = totalWorkAmount + totalAddAmount - totalDeductAmount
    const netAmount = grossAmount - retentionAmount

    return { totalWorkAmount, totalAddAmount, totalDeductAmount, grossAmount, netAmount }
  }, [jobs, adjustments, retentionPercent])

  // What is left of the main-work BOQ value after this approval, for the decision bar.
  const remainingAfter = useMemo(
    () => jobs.reduce((sum, job) => sum + Math.max(0, Number(job.totalBoq || 0) - Number(job.paid || 0) - Number(job.amount || 0)), 0),
    [jobs]
  )
  const requestedPercentOf = (jobId: string) => billing?.billing_jobs?.find((bj: Job) => bj.id === jobId)?.progress_percent ?? null
  const changedJobs = jobs.filter((job) => {
    const requested = requestedPercentOf(job.id)
    return requested != null && Math.abs(Number(job.progress_percent || 0) - Number(requested)) > 0.004
  }).length
  const isPending = billing?.status === 'pending_review'

  const adjustmentPlotOptions = useMemo(() => {
    const names = Array.from(
      new Set(
        (jobs || [])
          .map((job: Job) => job.job_assignments?.plots?.name)
          .filter((name: string | null | undefined): name is string => Boolean(name))
      )
    )
    names.sort((a, b) => a.localeCompare(b, 'th', { numeric: true, sensitivity: 'base' }))
    return names
  }, [jobs])

  // Initial progress history already arrived as a prop from the server -
  // only refetch when the job list actually changes underneath it (e.g. a
  // row gets removed).
  const isFirstJobsEffect = useRef(true)
  useEffect(() => {
    if (isFirstJobsEffect.current) {
      isFirstJobsEffect.current = false
      return
    }
    const ids = Array.from(
      new Set(
        (jobs || [])
          .map((job: Job) => job.job_assignments?.id)
          .filter((jobId: string | undefined): jobId is string => Boolean(jobId))
      )
    )
    if (ids.length === 0) {
      setProgressHistoryByJob({})
      return
    }
    let mounted = true
    getJobProgressHistory(ids)
      .then((res: Record<string, ProgressHistoryItem[]>) => {
        if (mounted) setProgressHistoryByJob(res || {})
      })
      .catch(() => {
        if (mounted) setProgressHistoryByJob({})
      })
    return () => {
      mounted = false
    }
  }, [jobs])

  const toggleHistory = (jobAssignmentId: string) => {
    setExpandedHistoryRows((prev) => {
      const next = new Set(prev)
      if (next.has(jobAssignmentId)) next.delete(jobAssignmentId)
      else next.add(jobAssignmentId)
      return next
    })
  }

  const handleApprove = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      const approvalData = {
        billing_date: billingDate,
        selected_jobs: jobs.map((j) => ({
          id: j.job_assignments?.id || '',
          job_assignment_id: j.job_assignments?.id || '',
          request_amount: j.amount,
          progress_percent: j.progress_percent,
        })),
        adjustments,
        total_work_amount: totalWorkAmount,
        total_add_amount: totalAddAmount,
        total_deduct_amount: totalDeductAmount,
        wht_percent: whtPercent,
        retention_percent: retentionPercent,
        net_amount: netAmount,
        type: billing?.type,
        attachment_urls: billing?.attachment_urls,
        reason_for_dc: billing?.reason_for_dc,
      }
      const result = await approveBilling(id, approvalData)
      if ('error' in result) {
        setError(result.error)
        return
      }
      router.push('/dashboard/billing?type=success&message=อนุมัติใบเบิกเรียบร้อยแล้ว')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await rejectBilling(id, rejectNote.trim() || undefined)
      if ('error' in result) {
        setError(result.error)
        return
      }
      router.push('/dashboard/billing?type=success&message=ปฏิเสธใบเบิกเรียบร้อยแล้ว')
    } finally {
      setIsSubmitting(false)
      setRejectModalOpen(false)
      setRejectNote('')
    }
  }

  const handleDelete = async () => {
    setIsSubmitting(true)
    try {
      const result = await deleteBilling(id)
      if ('error' in result) {
        setError(result.error)
        return
      }
      router.push('/dashboard/billing?type=success&message=ลบใบขอเบิกเรียบร้อยแล้ว')
    } finally {
      setIsSubmitting(false)
      setConfirmAction(null)
    }
  }

  const handleUndoApprove = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await undoApproveBilling(id)
      if ('error' in result) {
        setError(result.error)
        return
      }
      router.push('/dashboard/billing?type=success&message=ยกเลิกการอนุมัติเรียบร้อยแล้ว')
    } finally {
      setIsSubmitting(false)
      setConfirmAction(null)
    }
  }

  if (error && !billing) {
    return (
      <div className="container mx-auto max-w-lg space-y-4 p-4">
        <NoticeBanner tone="error" message={error} onClose={() => setError(null)} />
        <div className="text-center">
          <Link href="/dashboard/billing" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
            ← กลับไปรายการเบิกจ่าย
          </Link>
        </div>
      </div>
    )
  }

  if (!billing) {
    return (
      <div className="container mx-auto max-w-lg space-y-4 p-4">
        <p className="text-center text-slate-600">ไม่พบข้อมูลใบเบิก</p>
        <div className="text-center">
          <Link href="/dashboard/billing" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
            ← กลับไปรายการเบิกจ่าย
          </Link>
        </div>
      </div>
    )
  }

  return (
    <PageContainer width="wide">
      <div>
        <Breadcrumb items={[{ label: 'รายการเบิกจ่าย', href: '/dashboard/billing' }, { label: `ใบเบิก #${billing.doc_no}` }]} />
        <PageHeader
        title={`ตรวจสอบใบขอเบิก #${billing.doc_no}`}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(String(billing.status))}>{BILLING_STATUS_LABEL[billing.status as keyof typeof BILLING_STATUS_LABEL] ?? billing.status}</Badge>
            {isExtraWork && <Badge tone="neutral">งานเพิ่ม (DC)</Badge>}
            <span className="text-slate-500">
              {billing.projects?.name}
              {plotNames.length ? ` · แปลง ${plotNames.join(', ')}` : ''}
              {billing.contractors?.name ? ` · ${billing.contractors.name}` : ''}
            </span>
          </span>
        }
        actions={
          <>
            {canApprove && billing.status === 'approved' && !billing.paid_out_at && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmAction('undoApprove')} disabled={isSubmitting}>
                <Edit className="h-4 w-4" /> ย้อนสถานะอนุมัติ
              </Button>
            )}
            {!billing.paid_out_at && (
              <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => setConfirmAction('delete')}>
                <Trash2 className="h-4 w-4" /> ลบใบคำขอ
              </Button>
            )}
          </>
        }
        />
      </div>

      {error ? <NoticeBanner tone="error" message={error} onClose={() => setError(null)} /> : null}

      <>
          <PageSection title="ข้อมูลจาก Foreman" description="สิ่งที่ผู้ส่งคำขอแจ้งไว้ ก่อนที่ PM จะปรับ">
          <Card className="p-5">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ['โครงการ', billing.projects?.name || '-'],
                ['แปลง', plotNames.length ? plotNames.join(', ') : '-'],
                ['ผู้รับเหมา', billing.contractors?.name || '-'],
                ['ผู้ส่งคำขอ', billing.submitted_by_user?.full_name || billing.submitted_by_user?.email || 'ไม่ระบุผู้ใช้'],
                ['วันที่ส่ง', billing.created_at ? new Date(billing.created_at).toLocaleString('th-TH') : '-'],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-xs text-slate-500">{label}</dt>
                  <dd className="mt-0.5 break-words text-sm font-medium text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
            {billing.note && (
              <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                <span className="font-semibold">หมายเหตุ:</span> {billing.note}
              </p>
            )}
            {billing.status === 'rejected' && billing.review_note && (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <span className="font-semibold">เหตุผลที่ปฏิเสธ:</span> {billing.review_note}
              </p>
            )}
          </Card>
          </PageSection>

          {isExtraWork && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">หลักฐานงานเพิ่ม (DC)</h2>
                  <p className="text-sm text-slate-500">ตรวจเหตุผลและรูปถ่าย แล้วปรับรายการและราคาด้านล่างก่อนอนุมัติ</p>
                </div>
                <Badge tone="neutral">งานเพิ่ม (DC)</Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div className="space-y-2">
                  <p><span className="font-semibold">เหตุผล:</span> {billing.reason_for_dc || '-'}</p>
                </div>
                <div>
                  <p className="font-semibold mb-2">รูปถ่ายงานเพิ่ม</p>
                  {Array.isArray(billing.attachment_urls) && billing.attachment_urls.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {billing.attachment_urls.map((url: string, idx: number) => (
                        <a key={idx} href={url} target="_blank" rel="noopener noreferrer" aria-label={`เปิดรูปงานเพิ่ม ${idx + 1} ขนาดเต็ม`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt={`รูปงานเพิ่ม ${idx + 1}`} className="h-24 w-full rounded-lg border object-cover transition-opacity hover:opacity-90" />
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">ไม่มีรูปแนบ</p>
                  )}
                </div>
              </div>
            </Card>
          )}

          {!isExtraWork && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h2 className="text-lg font-semibold text-slate-900">รายการงานที่เบิก</h2>
                <p className="text-xs text-slate-500">
                  {changedJobs > 0 ? `ปรับ % แล้ว ${changedJobs} รายการ` : 'ยังไม่ได้ปรับ % จากที่ Foreman แจ้ง'} · แก้ช่อง “% อนุมัติ” เพื่อปรับยอด
                </p>
              </div>
              <TableFrame>
                <table>
                  <thead>
                    <tr>
                      <th className="px-6 py-3 text-left whitespace-nowrap">ชื่องาน</th>
                      <th className="px-6 py-3 text-right whitespace-nowrap">มูลค่าทั้งหมด</th>
                      <th className="px-6 py-3 text-right whitespace-nowrap">เบิกแล้ว</th>
                      <th className="px-6 py-3 text-right whitespace-nowrap">คงเหลือก่อนเบิก</th>
                      <th className="px-6 py-3 text-right whitespace-nowrap">% ที่แจ้ง</th>
                      <th className="px-6 py-3 text-right whitespace-nowrap">% อนุมัติ</th>
                      <th className="px-6 py-3 text-right whitespace-nowrap">ยอดเงิน</th>
                      <th className="px-6 py-3 text-right whitespace-nowrap">คงเหลือหลังเบิก</th>
                      <th className="px-6 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => {
                      const jobAssignmentId = job.job_assignments?.id
                      const isExpanded = expandedHistoryRows.has(jobAssignmentId)
                      const historyRows = (progressHistoryByJob[jobAssignmentId] || []).filter(
                        (history: ProgressHistoryItem) =>
                          String(history.status || '') !== 'pending_review' || String(history.doc_no || '') !== String(billing.doc_no || '')
                      )
                      const requestedPct = requestedPercentOf(job.id)
                      const changed = requestedPct != null && Math.abs(Number(job.progress_percent || 0) - Number(requestedPct)) > 0.004
                      const belowPrevious = Number(job.progress_percent || 0) < Number(job.previous_progress || 0)
                      return (
                        <Fragment key={job.id}>
                          <tr className={changed ? 'bg-indigo-50/40' : undefined}>
                            <td className="px-6 py-4">
                              <div>{job.job_assignments.boq_master.item_name}</div>
                              <div className="text-xs text-slate-500">แปลง {job.job_assignments.plots?.name || '-'}</div>
                              <button
                                type="button"
                                onClick={() => toggleHistory(jobAssignmentId)}
                                className="mt-1 text-xs text-indigo-600 hover:text-indigo-800"
                              >
                                {isExpanded ? 'ซ่อนประวัติความคืบหน้า' : 'ดูประวัติความคืบหน้า'}
                              </button>
                            </td>
                            <td className="px-6 py-4 text-right">{formatCurrency(job.totalBoq)}</td>
                            <td className="px-6 py-4 text-right">{formatCurrency(job.paid)}</td>
                            <td className="px-6 py-4 text-right font-medium text-slate-700">{formatCurrency(Math.max(0, Number(job.totalBoq || 0) - Number(job.paid || 0)))}</td>
                            <td className="px-6 py-4 text-right font-semibold text-blue-600">
                              {billing.billing_jobs.find((billingJob: Job) => billingJob.id === job.id)?.progress_percent?.toFixed(2)}%
                            </td>
                            <td className="px-6 py-4 text-right">
                              <input
                                type="number"
                                className="w-24 text-right"
                                aria-label={`% อนุมัติ ${job.job_assignments.boq_master.item_name}`}
                                aria-invalid={belowPrevious || undefined}
                                value={job.progress_percent || ''}
                                onChange={(e) => handleProgressChange(job.job_assignments.id, parseFloat(e.target.value))}
                                min={job.previous_progress.toFixed(2)}
                                max="100"
                                step="0.01"
                              />
                              {changed && (
                                <p className="mt-1 text-[11px] font-medium text-indigo-700">
                                  ปรับจาก {Number(requestedPct).toFixed(2)}%
                                </p>
                              )}
                              {belowPrevious && (
                                <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-red-700">
                                  <AlertTriangle className="h-3 w-3" aria-hidden /> ต้องไม่ต่ำกว่า {Number(job.previous_progress).toFixed(2)}%
                                </p>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right font-medium">{formatCurrency(job.amount || 0)}</td>
                            <td className="px-6 py-4 text-right font-semibold text-emerald-700">{formatCurrency(Math.max(0, Number(job.totalBoq || 0) - Number(job.paid || 0) - Number(job.amount || 0)))}</td>
                            <td className="px-6 py-4 text-right">
                              <button
                                type="button"
                                onClick={() => removeJob(job.id)}
                                title="ลบรายการนี้ออกจากใบเบิก (เช่น รายการซ้ำ)"
                                aria-label="ลบรายการนี้ออกจากใบเบิก"
                                className="rounded-lg p-2 text-red-500 hover:bg-red-50 hover:text-red-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={9} className="px-6 pb-4 pt-1">
                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                  <div className="text-xs font-semibold text-slate-700 mb-2">ประวัติความคืบหน้าเดิม</div>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-sm border border-slate-200 bg-white">
                                      <thead className="bg-slate-100">
                                        <tr>
                                          <th className="px-2 py-1 text-left">เลขที่ใบเบิก</th>
                                          <th className="px-2 py-1 text-left">วันที่</th>
                                          <th className="px-2 py-1 text-left">สถานะ</th>
                                          <th className="px-2 py-1 text-right">%</th>
                                          <th className="px-2 py-1 text-right">ยอดเบิก</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {historyRows.length === 0 ? (
                                          <tr>
                                            <td colSpan={5} className="px-2 py-2 text-center text-slate-500">ยังไม่มีประวัติก่อนหน้า</td>
                                          </tr>
                                        ) : historyRows.map((history: ProgressHistoryItem) => (
                                          <tr key={history.id} className="border-t border-slate-100">
                                            <td className="px-2 py-1">#{String(history.doc_no || '-').padStart(4, '0')}</td>
                                            <td className="px-2 py-1">
                                              {history.billing_date
                                                ? new Date(history.billing_date).toLocaleDateString('th-TH')
                                                : history.created_at
                                                  ? new Date(history.created_at).toLocaleDateString('th-TH')
                                                  : '-'}
                                            </td>
                                            <td className="px-2 py-1">{history.status || '-'}</td>
                                            <td className="px-2 py-1 text-right">
                                              {history.progress_percent == null ? '-' : `${Number(history.progress_percent).toFixed(2)}%`}
                                            </td>
                                            <td className="px-2 py-1 text-right">{formatCurrency(history.amount || 0)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </TableFrame>
            </div>
          )}

          <PageSection title="รายการปรับปรุง (งานเพิ่ม/งานหัก)" description="เพิ่มหรือหักรายการนอกเหนือจากงานที่เบิก">
          <Card className="p-4">
            <AdjustmentLineItems
              adjustments={adjustments}
              plotOptions={adjustmentPlotOptions}
              onChange={handleAdjustmentChange}
              onAdd={addAdjustment}
              onRemove={removeAdjustment}
              totalAddAmount={totalAddAmount}
              totalDeductAmount={totalDeductAmount}
              showSignature
            />
          </Card>
          </PageSection>

          <PageSection title="สรุปและคำนวณยอดสุดท้าย" description="ยอดที่จะอนุมัติ หลังปรับ % และรายการปรับปรุง">
          <Card className="p-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div><label className="block text-sm font-medium text-gray-700">วันที่เบิกจ่าย</label><input type="date" value={billingDate} onChange={(e) => setBillingDate(e.target.value)} className="mt-1 block w-full p-2 border border-gray-300 rounded-md" /></div>
              </div>
              <p className="mb-4 text-xs text-slate-500">หัก ณ ที่จ่ายและประกันผลงานจะดำเนินการโดยฝ่ายบัญชีในหน้ารอบจ่ายผู้รับเหมา</p>
              <div className="mt-4 p-4 bg-white rounded-lg border">
                <table className="w-full text-sm">
                  <tbody>
                    {totalWorkAmount > 0 && (
                      <tr>
                        <td className="py-0.5 text-gray-600">งานหลัก</td>
                        <td className="py-0.5 text-right font-medium">฿{formatCurrency(totalWorkAmount)}</td>
                      </tr>
                    )}
                    {totalAddAmount > 0 && (
                      <tr>
                        <td className="py-0.5 text-gray-600">งานเพิ่ม DC</td>
                        <td className="py-0.5 text-right font-medium text-green-700">฿{formatCurrency(totalAddAmount)}</td>
                      </tr>
                    )}
                    {totalDeductAmount > 0 && (
                      <tr>
                        <td className="py-0.5 text-gray-600">งานหัก</td>
                        <td className="py-0.5 text-right font-medium text-red-600">−฿{formatCurrency(totalDeductAmount)}</td>
                      </tr>
                    )}
                    <tr><td colSpan={2}><hr className="my-1" /></td></tr>
                    <tr>
                      <td className="py-1 font-bold text-base">ยอดสุทธิอนุมัติ</td>
                      <td className="py-1 text-right font-bold text-xl text-emerald-700">฿{formatCurrency(netAmount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
          </PageSection>
      </>

      {/* Decision bar: the numbers being decided and the decision itself stay together. */}
      <div className="sticky bottom-4 z-20">
        <Card className="elev-floating flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3">
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-1">
            {totalWorkAmount > 0 && (
              <div>
                <dt className="text-xs text-slate-500">งานหลัก</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-900">฿{formatCurrency(totalWorkAmount)}</dd>
              </div>
            )}
            {totalAddAmount > 0 && (
              <div>
                <dt className="text-xs text-slate-500">งานเพิ่ม (DC)</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-900">+฿{formatCurrency(totalAddAmount)}</dd>
              </div>
            )}
            {totalDeductAmount > 0 && (
              <div>
                <dt className="text-xs text-slate-500">งานหัก</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-900">−฿{formatCurrency(totalDeductAmount)}</dd>
              </div>
            )}
            {!isExtraWork && (
              <div>
                <dt className="text-xs text-slate-500">คงเหลือหลังเบิก</dt>
                <dd className="text-sm font-semibold tabular-nums text-slate-900">฿{formatCurrency(remainingAfter)}</dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-slate-500">ยอดสุทธิอนุมัติ</dt>
              <dd className="text-xl font-bold tabular-nums text-emerald-700">฿{formatCurrency(netAmount)}</dd>
            </div>
          </dl>
          {canApprove && isPending ? (
            <div className="flex items-center gap-3">
              <Button variant="danger" onClick={() => setRejectModalOpen(true)} disabled={isSubmitting}>
                {isSubmitting ? 'กำลังปฏิเสธ...' : 'ปฏิเสธ'}
              </Button>
              <Button onClick={() => setConfirmAction('approve')} disabled={isSubmitting}>
                {isSubmitting ? 'กำลังอนุมัติ...' : 'อนุมัติและจบงาน'}
              </Button>
            </div>
          ) : (
            <Badge tone={statusTone(String(billing.status))}>
              {BILLING_STATUS_LABEL[billing.status as keyof typeof BILLING_STATUS_LABEL] ?? billing.status}
            </Badge>
          )}
        </Card>
      </div>

      <ConfirmDialog
        isOpen={confirmAction === 'approve'}
        title="อนุมัติใบเบิก"
        message={`อนุมัติใบเบิก #${billing.doc_no} ยอดสุทธิ ฿${formatCurrency(netAmount)} ใช่หรือไม่?`}
        confirmLabel={isSubmitting ? 'กำลังอนุมัติ...' : 'ยืนยันอนุมัติ'}
        cancelLabel="ยกเลิก"
        tone="primary"
        busy={isSubmitting}
        onCancel={() => setConfirmAction(null)}
        onConfirm={async () => {
          await handleApprove()
          setConfirmAction(null)
        }}
      />

      <ConfirmDialog
        isOpen={confirmAction === 'delete'}
        title="ลบใบขอเบิก"
        message="ต้องการลบใบขอเบิกนี้ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้"
        confirmLabel={isSubmitting ? 'กำลังลบ...' : 'ลบใบคำขอ'}
        cancelLabel="ยกเลิก"
        busy={isSubmitting}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        isOpen={confirmAction === 'undoApprove'}
        title="ย้อนสถานะอนุมัติ"
        message="ต้องการย้อนสถานะอนุมัติกลับไปเป็นรอตรวจสอบใช่หรือไม่? ระบบจะลบรายการจ่ายที่สร้างจากใบเบิกนี้"
        confirmLabel={isSubmitting ? 'กำลังย้อนสถานะ...' : 'ย้อนสถานะ'}
        cancelLabel="ยกเลิก"
        tone="primary"
        busy={isSubmitting}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleUndoApprove}
      />

      <Modal isOpen={rejectModalOpen} onClose={() => setRejectModalOpen(false)} title="ปฏิเสธใบเบิก">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">เหตุผลที่ปฏิเสธ (ไม่บังคับ)</label>
            <textarea
              rows={4}
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              className="w-full rounded-md border border-slate-300 p-2"
              placeholder="ระบุเหตุผลหรือข้อแก้ไขที่ต้องการแจ้งกลับ"
            />
          </div>
          <div className="flex justify-end gap-3 border-t pt-4">
            <Button type="button" variant="secondary" onClick={() => setRejectModalOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleReject}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'กำลังปฏิเสธ...' : 'ยืนยันการปฏิเสธ'}
            </Button>
          </div>
        </div>
      </Modal>
    </PageContainer>
  )
}
