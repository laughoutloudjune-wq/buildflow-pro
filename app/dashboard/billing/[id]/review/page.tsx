'use client'

import { Fragment, useState, useEffect, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { getBillingById, approveBilling, rejectBilling, deleteBilling, undoApproveBilling, getJobProgressHistory } from '@/actions/billing-actions'
import { getOrganizationSettings } from '@/actions/settings-actions'
import { Card } from '@/components/ui/Card'
import { BillingPdf } from '@/components/pdf/BillingPdf'
import { Plus, Trash2, Edit, Loader2 } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import NoticeBanner from '@/components/ui/NoticeBanner'
import ClientRoleGate from '@/components/auth/ClientRoleGate'
import type { BillingAdjustmentForm, ProgressHistoryItem } from '@/lib/types/billing'

const PDFViewer = dynamic(
  () => import('@react-pdf/renderer').then((mod) => mod.PDFViewer),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[400px] text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">กำลังสร้างเอกสาร PDF...</span>
      </div>
    ),
  }
)

type BillingData = Awaited<ReturnType<typeof getBillingById>>
type SettingsData = Awaited<ReturnType<typeof getOrganizationSettings>>
type Job = NonNullable<NonNullable<BillingData>['billing_jobs']>[number]
type Adjustment = BillingAdjustmentForm & { id?: string }

export default function ReviewBillingPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [billing, setBilling] = useState<BillingData>(null)
  const [settings, setSettings] = useState<SettingsData>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [billingDate, setBillingDate] = useState(new Date().toISOString().split('T')[0])
  const [whtPercent, setWhtPercent] = useState(0)
  const [retentionPercent, setRetentionPercent] = useState(0)
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit')
  const [progressHistoryByJob, setProgressHistoryByJob] = useState<Record<string, ProgressHistoryItem[]>>({})
  const [expandedHistoryRows, setExpandedHistoryRows] = useState<Set<string>>(new Set())

  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<'delete' | 'undoApprove' | null>(null)
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState('')

  useEffect(() => {
    if (!id) return
    async function fetchData() {
      try {
        const [billingData, settingsData] = await Promise.all([
          getBillingById(id),
          getOrganizationSettings(),
        ])

        if (billingData) {
          setBilling(billingData)
          setJobs(Array.isArray(billingData.billing_jobs) ? billingData.billing_jobs : [])
          setAdjustments(
            Array.isArray(billingData.billing_adjustments)
              ? billingData.billing_adjustments.map((adj: Adjustment) => ({
                  ...adj,
                  plot_name: adj.plot_name || '',
                }))
              : []
          )
          setWhtPercent(billingData.wht_percent ?? 0)
          setRetentionPercent(billingData.retention_percent ?? 0)
          if (billingData.billing_date) {
            setBillingDate(new Date(billingData.billing_date).toISOString().split('T')[0])
          }
        } else {
          setError('ไม่พบใบเบิกนี้')
        }
        setSettings(settingsData)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load billing')
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [id])

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

  const { totalWorkAmount, totalAddAmount, totalDeductAmount, grossAmount, netAmount, whtAmount, retentionAmount } = useMemo(() => {
    const totalWorkAmount = jobs.reduce((sum, job) => sum + (job.amount || 0), 0)
    const totalAddAmount = adjustments.filter((adj) => adj.type === 'addition').reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)
    const totalDeductAmount = adjustments.filter((adj) => adj.type === 'deduction').reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)

    const retentionAmount = totalWorkAmount * (retentionPercent / 100)

    // DC (extra_work): WHT on total_add_amount, mandatory, billed by accounting at pay-out
    // Main job: no WHT — only retention is deducted here
    const whtAmount = isExtraWork ? totalAddAmount * (whtPercent / 100) : 0

    const grossAmount = totalWorkAmount + totalAddAmount - totalDeductAmount
    // WHT is NOT baked into net_amount — accounting deducts it at pay-out time for DC billings.
    const netAmount = (totalWorkAmount - retentionAmount) + totalAddAmount - totalDeductAmount

    return { totalWorkAmount, totalAddAmount, totalDeductAmount, grossAmount, netAmount, whtAmount, retentionAmount }
  }, [jobs, adjustments, whtPercent, retentionPercent, isExtraWork])

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

  useEffect(() => {
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
      await approveBilling(id, approvalData)
      router.push('/dashboard/billing?type=success&message=อนุมัติใบเบิกเรียบร้อยแล้ว')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      await rejectBilling(id, rejectNote.trim() || undefined)
      router.push('/dashboard/billing?type=success&message=ปฏิเสธใบเบิกเรียบร้อยแล้ว')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reject failed')
    } finally {
      setIsSubmitting(false)
      setRejectModalOpen(false)
      setRejectNote('')
    }
  }

  const handleDelete = async () => {
    setIsSubmitting(true)
    try {
      await deleteBilling(id)
      router.push('/dashboard/billing?type=success&message=ลบใบขอเบิกเรียบร้อยแล้ว')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setIsSubmitting(false)
      setConfirmAction(null)
    }
  }

  const handleUndoApprove = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      await undoApproveBilling(id)
      router.push('/dashboard/billing?type=success&message=ยกเลิกการอนุมัติเรียบร้อยแล้ว')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Undo approve failed')
    } finally {
      setIsSubmitting(false)
      setConfirmAction(null)
    }
  }

  const previewData = useMemo(
    () => ({
      ...billing,
      billing_jobs: jobs,
      billing_adjustments: adjustments,
      billing_date: billingDate,
      wht_percent: whtPercent,
      retention_percent: retentionPercent,
      total_work_amount: totalWorkAmount,
      total_add_amount: totalAddAmount,
      total_deduct_amount: totalDeductAmount,
      net_amount: netAmount,
    }),
    [billing, jobs, adjustments, billingDate, whtPercent, retentionPercent, totalWorkAmount, totalAddAmount, totalDeductAmount, netAmount]
  )

  if (isLoading) return <p className="text-center p-8">กำลังโหลด...</p>
  if (error && !billing) return <p className="text-red-500 text-center p-8">{error}</p>
  if (!billing) return <p className="text-center p-8">ไม่พบข้อมูลใบเบิก</p>

  return (
    <div className="container mx-auto p-4 space-y-4">
      <ClientRoleGate moduleKey="billing" />

      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold mb-0">ตรวจสอบใบขอเบิก #{billing.doc_no}</h1>
        <div className="flex items-center gap-3">
          {billing.status === 'approved' && (
            <button onClick={() => setConfirmAction('undoApprove')} disabled={isSubmitting} className="flex items-center gap-2 text-sm text-amber-700 hover:text-amber-900 disabled:opacity-50">
              <Edit className="h-4 w-4" /> Undo Approve
            </button>
          )}
          <button onClick={() => setConfirmAction('delete')} className="flex items-center gap-2 text-sm text-red-600 hover:text-red-800">
            <Trash2 className="h-4 w-4" /> ลบใบคำขอ
          </button>
        </div>
      </div>

      {error ? <NoticeBanner tone="error" message={error} onClose={() => setError(null)} /> : null}

      <div className="flex border-b">
        <button
          onClick={() => setActiveTab('edit')}
          className={`flex-1 py-3 text-sm font-bold transition flex items-center justify-center gap-2 ${
            activeTab === 'edit' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          <Edit className="h-4 w-4" /> แก้ไขข้อมูล
        </button>
      </div>

      {activeTab === 'edit' && (
        <>
          <Card className="p-4 bg-slate-50">
            <h2 className="text-xl font-semibold mb-3">ข้อมูลจาก Foreman</h2>
            <div className="grid grid-cols-2 gap-4">
              <p><span className="font-semibold">โครงการ:</span> {billing.projects?.name}</p>
              <p><span className="font-semibold">แปลง:</span> {plotNames.length ? plotNames.join(', ') : '-'}</p>
              <p><span className="font-semibold">ผู้รับเหมา:</span> {billing.contractors?.name}</p>
              <p><span className="font-semibold">ผู้ส่งคำขอ:</span> {billing.submitted_by_user?.full_name || billing.submitted_by_user?.email || 'ไม่ระบุผู้ใช้'}</p>
              <p><span className="font-semibold">วันที่ส่ง:</span> {billing.created_at ? new Date(billing.created_at).toLocaleString('th-TH') : '-'}</p>
            </div>
            {billing.note && <p className="mt-4"><span className="font-semibold">หมายเหตุ:</span> {billing.note}</p>}
          </Card>

          {isExtraWork && (
            <Card className="p-4 border-amber-200 bg-amber-50/40">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold text-amber-800">ตรวจสอบงานเพิ่ม (DC)</h2>
                  <p className="text-sm text-amber-700">ปรับรายการและราคาได้ก่อนอนุมัติ</p>
                </div>
                <span className="px-3 py-1 text-xs font-semibold rounded-full bg-amber-200 text-amber-900">EXTRA WORK</span>
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
                        <img key={idx} src={url} alt={`dc-${idx + 1}`} className="h-24 w-full object-cover rounded border" />
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
            <Card className="p-4">
              <h2 className="text-xl font-semibold mb-2">รายการงานที่เบิก</h2>
              <div className="overflow-x-auto mb-6">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ชื่องาน</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">มูลค่าทั้งหมด</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">เบิกแล้ว</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">คงเหลือก่อนเบิก</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Foreman %</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">PM %</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">ยอดเงิน</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">คงเหลือหลังเบิก</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {jobs.map((job) => {
                      const jobAssignmentId = job.job_assignments?.id
                      const isExpanded = expandedHistoryRows.has(jobAssignmentId)
                      const historyRows = (progressHistoryByJob[jobAssignmentId] || []).filter(
                        (history: ProgressHistoryItem) =>
                          String(history.status || '') !== 'pending_review' || String(history.doc_no || '') !== String(billing.doc_no || '')
                      )
                      return (
                        <Fragment key={job.id}>
                          <tr>
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
                                className="w-24 p-1 border border-gray-300 rounded-md text-right"
                                value={job.progress_percent || ''}
                                onChange={(e) => handleProgressChange(job.job_assignments.id, parseFloat(e.target.value))}
                                min={job.previous_progress.toFixed(2)}
                                max="100"
                                step="0.01"
                              />
                            </td>
                            <td className="px-6 py-4 text-right font-medium">{formatCurrency(job.amount || 0)}</td>
                            <td className="px-6 py-4 text-right font-semibold text-emerald-700">{formatCurrency(Math.max(0, Number(job.totalBoq || 0) - Number(job.paid || 0) - Number(job.amount || 0)))}</td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={8} className="px-6 pb-4 pt-1">
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
                                            <td colSpan={5} className="px-2 py-2 text-center text-slate-400">ยังไม่มีประวัติก่อนหน้า</td>
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
              </div>
            </Card>
          )}

          <Card className="p-4">
            <h2 className="text-xl font-semibold mb-2">รายการปรับปรุง (งานเพิ่ม/งานหัก)</h2>
            {adjustments.map((adj, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 mb-2 items-center">
                <div className="col-span-2">
                  <select value={adj.type} onChange={(e) => handleAdjustmentChange(index, 'type', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md">
                    <option value="addition">งานเพิ่ม</option>
                    <option value="deduction">งานหัก</option>
                  </select>
                </div>
                <div className="col-span-2">
                  {adjustmentPlotOptions.length > 0 ? (
                    <select value={adj.plot_name || ''} onChange={(e) => handleAdjustmentChange(index, 'plot_name', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md">
                      <option value="">แปลง (ถ้ามี)</option>
                      {adjustmentPlotOptions.map((plot) => <option key={plot} value={plot}>{plot}</option>)}
                    </select>
                  ) : (
                    <input type="text" placeholder="แปลง" value={adj.plot_name || ''} onChange={(e) => handleAdjustmentChange(index, 'plot_name', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" />
                  )}
                </div>
                <div className="col-span-3">
                  <input type="text" placeholder="รายละเอียด" value={adj.description} onChange={(e) => handleAdjustmentChange(index, 'description', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" />
                  {adj.signature?.user_id ? (
                    <div className="mt-1 text-[11px] text-slate-500">
                      ลงชื่อโดย {adj.signature?.full_name || 'ไม่ระบุผู้แก้ไข'}
                      {adj.signature?.role ? ` (${adj.signature.role})` : ''}
                      {adj.signature?.at ? ` • ${new Date(adj.signature.at).toLocaleString('th-TH')}` : ''}
                    </div>
                  ) : null}
                </div>
                <div className="col-span-1"><input type="text" placeholder="หน่วย" value={adj.unit} onChange={(e) => handleAdjustmentChange(index, 'unit', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" /></div>
                <div className="col-span-1"><input type="number" placeholder="จำนวน" value={adj.quantity} onChange={(e) => handleAdjustmentChange(index, 'quantity', parseFloat(e.target.value))} className="w-full p-2 border border-gray-300 rounded-md" /></div>
                <div className="col-span-2"><input type="number" placeholder="ราคาต่อหน่วย" value={adj.unit_price} onChange={(e) => handleAdjustmentChange(index, 'unit_price', parseFloat(e.target.value))} className="w-full p-2 border border-gray-300 rounded-md" /></div>
                <div className="col-span-1"><button onClick={() => removeAdjustment(index)} className="p-2 text-red-500 hover:text-red-700"><Trash2 className="h-5 w-5" /></button></div>
              </div>
            ))}
            <button onClick={() => addAdjustment('addition')} className="flex items-center gap-1 text-sm text-green-600 hover:text-green-800 mt-2"><Plus className="h-4 w-4" />เพิ่มรายการงานเพิ่ม</button>
            <button onClick={() => addAdjustment('deduction')} className="flex items-center gap-1 text-sm text-red-600 hover:text-red-800 mt-1"><Plus className="h-4 w-4" />เพิ่มรายการงานหัก</button>

            <h2 className="text-xl font-semibold mt-6 mb-2">สรุปและคำนวณยอดสุดท้าย</h2>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div><label className="block text-sm font-medium text-gray-700">วันที่เบิกจ่าย</label><input type="date" value={billingDate} onChange={(e) => setBillingDate(e.target.value)} className="mt-1 block w-full p-2 border border-gray-300 rounded-md" /></div>
                {isExtraWork ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">หัก ณ ที่จ่าย (WHT) % <span className="text-xs text-amber-600">(DC — บังคับหักทุกครั้ง)</span></label>
                    <input type="number" value={whtPercent} onChange={(e) => setWhtPercent(parseFloat(e.target.value))} className="mt-1 block w-full p-2 border border-gray-300 rounded-md" />
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">ประกันผลงาน (Retention) %</label>
                    <input type="number" value={retentionPercent} onChange={(e) => setRetentionPercent(parseFloat(e.target.value))} className="mt-1 block w-full p-2 border border-gray-300 rounded-md" />
                  </div>
                )}
              </div>
              <div className="mt-4 p-4 bg-white rounded-lg border text-right space-y-1">
                {isExtraWork ? (
                  <>
                    {/* DC billing breakdown */}
                    <p className="text-sm text-gray-600">ยอดงานเพิ่ม (DC):
                      <span className="font-semibold text-green-600 w-36 inline-block">฿{formatCurrency(totalAddAmount)}</span>
                    </p>
                    {totalDeductAmount > 0 && (
                      <p className="text-sm text-gray-600">ยอดงานหัก:
                        <span className="font-semibold text-red-600 w-36 inline-block">−฿{formatCurrency(totalDeductAmount)}</span>
                      </p>
                    )}
                    <hr className="my-1" />
                    <p className="font-semibold">ยอดรวม DC:
                      <span className="w-36 inline-block">฿{formatCurrency(totalAddAmount - totalDeductAmount)}</span>
                    </p>
                    <p className="text-sm text-gray-600">หัก ณ ที่จ่าย (WHT {whtPercent}% จากยอดงานเพิ่ม):
                      <span className="font-semibold text-red-600 w-36 inline-block">−฿{formatCurrency(whtAmount)}</span>
                    </p>
                    <hr className="my-1" />
                    <p className="font-bold text-xl">ยอดสุทธิอนุมัติ (Net):
                      <span className="text-2xl text-emerald-700 w-36 inline-block">฿{formatCurrency(netAmount)}</span>
                    </p>
                    <p className="text-sm font-semibold text-amber-700 mt-1">ยอดโอนจริง (Net − WHT):
                      <span className="text-lg w-36 inline-block">฿{formatCurrency(netAmount - whtAmount)}</span>
                    </p>
                  </>
                ) : (
                  <>
                    {/* Main job billing breakdown */}
                    <p className="text-sm text-gray-600">ยอดเบิกตามเนื้องาน:
                      <span className="font-semibold text-gray-800 w-36 inline-block">฿{formatCurrency(totalWorkAmount)}</span>
                    </p>
                    {totalAddAmount > 0 && (
                      <p className="text-sm text-gray-600">ยอดงานเพิ่ม:
                        <span className="font-semibold text-green-600 w-36 inline-block">฿{formatCurrency(totalAddAmount)}</span>
                      </p>
                    )}
                    {totalDeductAmount > 0 && (
                      <p className="text-sm text-gray-600">ยอดงานหัก:
                        <span className="font-semibold text-red-600 w-36 inline-block">−฿{formatCurrency(totalDeductAmount)}</span>
                      </p>
                    )}
                    <hr className="my-1" />
                    <p className="font-semibold">ยอดรวม:
                      <span className="w-36 inline-block">฿{formatCurrency(grossAmount)}</span>
                    </p>
                    <p className="text-sm text-gray-600">หักประกันผลงาน (Retention {retentionPercent}% จากยอดงานหลัก):
                      <span className="font-semibold text-red-600 w-36 inline-block">−฿{formatCurrency(retentionAmount)}</span>
                    </p>
                    <hr className="my-1" />
                    <p className="font-bold text-xl">ยอดสุทธิอนุมัติ (Net):
                      <span className="text-2xl text-emerald-700 w-36 inline-block">฿{formatCurrency(netAmount)}</span>
                    </p>
                    <p className="text-xs text-blue-600 mt-1">* ไม่มีการหัก WHT สำหรับงานหลัก — บัญชีโอนเต็มยอด Net</p>
                  </>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-4">
              <button onClick={() => setRejectModalOpen(true)} disabled={isSubmitting} className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 font-semibold">
                {isSubmitting ? 'กำลังปฏิเสธ...' : 'ปฏิเสธ'}
              </button>
              <button onClick={handleApprove} disabled={isSubmitting} className="px-6 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 font-bold">
                {isSubmitting ? 'กำลังอนุมัติ...' : 'อนุมัติและจบงาน'}
              </button>
            </div>
          </Card>
        </>
      )}

      {activeTab === 'preview' && (
        <div className="h-[75vh] w-full bg-slate-500 rounded-lg shadow-inner overflow-hidden flex flex-col">
          <PDFViewer className="w-full h-full border-none">
            <BillingPdf data={previewData} settings={settings} />
          </PDFViewer>
        </div>
      )}

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
            <button type="button" onClick={() => setRejectModalOpen(false)} className="btn-secondary">
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={isSubmitting}
              className="rounded-lg bg-red-600 px-4 py-2 text-white shadow transition hover:bg-red-700 disabled:opacity-60"
            >
              {isSubmitting ? 'กำลังปฏิเสธ...' : 'ยืนยันการปฏิเสธ'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
