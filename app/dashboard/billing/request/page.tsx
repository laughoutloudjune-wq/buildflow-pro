'use client'

import { Fragment, useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getBillingOptions, getBillableJobs, createBillingRequest, getBillingById, updateBillingRequest, getJobProgressHistory } from '@/actions/billing-actions'
import { Card } from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import AdjustmentLineItems from '@/components/billings/AdjustmentLineItems'
import JobMaterialLogModal from '@/components/materials/JobMaterialLogModal'
import { CheckCircle, Boxes } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import type { BillingAdjustmentForm, BillableJob, BillingAdjustmentRecord, ContractorOption, ProgressHistoryItem, ProjectOption, SelectedBillingJobState } from '@/lib/types/billing'

type Adjustment = BillingAdjustmentForm
type BillingDetail = Awaited<ReturnType<typeof getBillingById>>

export default function CreateBillingRequestPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('editId')

  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [contractors, setContractors] = useState<ContractorOption[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [selectedContractor, setSelectedContractor] = useState('')
  const [billableJobs, setBillableJobs] = useState<BillableJob[]>([])
  const [jobSearch, setJobSearch] = useState('')
  const [jobPlotFilter, setJobPlotFilter] = useState('')
  const [selectedJobs, setSelectedJobs] = useState<Map<string, SelectedBillingJobState>>(new Map())
  const [progressHistoryByJob, setProgressHistoryByJob] = useState<Record<string, ProgressHistoryItem[]>>({})
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [note, setNote] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [successNextPath, setSuccessNextPath] = useState('/dashboard/foreman/history')
  const [submittedData, setSubmittedData] = useState<{ project_id: string; contractor_id: string; net_amount: number; doc_no?: string | number } | null>(null)
  const [editingBilling, setEditingBilling] = useState<BillingDetail>(null)
  const [didPrefillJobs, setDidPrefillJobs] = useState(false)
  const [materialsJob, setMaterialsJob] = useState<{ id: string; label: string } | null>(null)

  useEffect(() => {
    async function fetchOptions() {
      const { projects, contractors } = await getBillingOptions()
      setProjects(projects)
      setContractors(contractors)
    }
    fetchOptions()
  }, [])

  useEffect(() => {
    if (!editId) return
    async function fetchBillingForEdit() {
      try {
        const billing = await getBillingById(editId as string)
        if (!billing) return
        setEditingBilling(billing)
        setSelectedProject(billing.project_id || '')
        setSelectedContractor(billing.contractor_id || '')
        setNote(billing.note || '')
        setAdjustments(
          (billing.billing_adjustments || []).map((adj: BillingAdjustmentRecord) => ({
            type: adj.type,
            description: adj.description || '',
            plot_name: adj.plot_name || '',
            unit: adj.unit || '',
            quantity: Number(adj.quantity || 0),
            unit_price: Number(adj.unit_price || 0),
          }))
        )
        setDidPrefillJobs(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'โหลดข้อมูลใบขอเบิกไม่สำเร็จ')
      }
    }
    fetchBillingForEdit()
  }, [editId])

  useEffect(() => {
    if (!selectedProject || !selectedContractor) return
    async function fetchJobs() {
      setIsLoading(true)
      const jobs = await getBillableJobs(selectedProject, selectedContractor)
      const jobsWithProgress = jobs.map((job: BillableJob) => ({
        ...job,
        previous_progress: job.totalBoq > 0 ? (job.paid / job.totalBoq) * 100 : 0,
      }))
      setBillableJobs(jobsWithProgress)
      setSelectedJobs(new Map())
      setProgressHistoryByJob({})
      setIsLoading(false)
    }
    fetchJobs()
  }, [selectedProject, selectedContractor])

  useEffect(() => {
    if (!editId || !editingBilling || didPrefillJobs || billableJobs.length === 0) return

    const next = new Map<string, { progress: string; request_amount: number }>()
    for (const row of editingBilling.billing_jobs || []) {
      const jobAssignmentId = row.job_assignments?.id
      if (!jobAssignmentId) continue
      next.set(jobAssignmentId, {
        progress: row.progress_percent == null ? '' : String(row.progress_percent),
        request_amount: Number(row.amount || 0),
      })
    }
    setSelectedJobs(next)
    setDidPrefillJobs(true)
  }, [editId, editingBilling, didPrefillJobs, billableJobs])

  useEffect(() => {
    const selectedIds = Array.from(selectedJobs.keys())
    if (selectedIds.length === 0) {
      setProgressHistoryByJob({})
      return
    }

    let mounted = true
    getJobProgressHistory(selectedIds)
      .then((res: Record<string, ProgressHistoryItem[]>) => {
        if (mounted) setProgressHistoryByJob(res || {})
      })
      .catch(() => {
        if (mounted) setProgressHistoryByJob({})
      })

    return () => {
      mounted = false
    }
  }, [selectedJobs])

  const handleJobSelection = (jobId: string, job: BillableJob) => {
    const newSelectedJobs = new Map(selectedJobs)
    const previousProgress = job.previous_progress ?? 0
    if (newSelectedJobs.has(jobId)) {
      newSelectedJobs.delete(jobId)
    } else {
      newSelectedJobs.set(jobId, { progress: previousProgress.toFixed(2), request_amount: 0 })
    }
    setSelectedJobs(newSelectedJobs)
  }

  const handleProgressChange = (jobId: string, job: BillableJob, progressStr: string) => {
    const newSelectedJobs = new Map(selectedJobs)

    if (progressStr === '') {
      newSelectedJobs.set(jobId, { progress: '', request_amount: 0 })
      setSelectedJobs(newSelectedJobs)
      return
    }

    const progress = parseFloat(progressStr)
    if (isNaN(progress) || progress < 0 || progress > 100) {
      newSelectedJobs.set(jobId, { progress: progressStr, request_amount: selectedJobs.get(jobId)?.request_amount || 0 })
      setSelectedJobs(newSelectedJobs)
      return
    }

    const newAmount = (job.totalBoq * progress / 100) - job.paid
    newSelectedJobs.set(jobId, { progress: progressStr, request_amount: Math.max(0, newAmount) })
    setSelectedJobs(newSelectedJobs)
  }

  const handleAdjustmentChange = (index: number, field: keyof Adjustment, value: Adjustment[keyof Adjustment]) => {
    const newAdjustments = [...adjustments]
    newAdjustments[index] = { ...newAdjustments[index], [field]: value }
    setAdjustments(newAdjustments)
  }

  const addAdjustment = (type: 'addition' | 'deduction') => {
    setAdjustments([...adjustments, { type, description: '', plot_name: '', unit: 'หน่วย', quantity: 1, unit_price: 0 }])
  }

  const removeAdjustment = (index: number) => {
    setAdjustments(adjustments.filter((_: Adjustment, i: number) => i !== index))
  }

  const { totalWorkAmount, totalAddAmount, totalDeductAmount, netAmount } = useMemo(() => {
    const totalWorkAmount = Array.from(selectedJobs.values()).reduce((sum, job) => sum + job.request_amount, 0)
    const totalAddAmount = adjustments.filter((adj) => adj.type === 'addition').reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)
    const totalDeductAmount = adjustments.filter((adj) => adj.type === 'deduction').reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)
    const netAmount = totalWorkAmount + totalAddAmount - totalDeductAmount
    return { totalWorkAmount, totalAddAmount, totalDeductAmount, netAmount }
  }, [selectedJobs, adjustments])

  const adjustmentPlotOptions = useMemo(() => {
    const names = Array.from(
      new Set((billableJobs || []).map((job: BillableJob) => job.plots?.name).filter((name: string | undefined): name is string => Boolean(name)))
    )
    names.sort((a, b) => a.localeCompare(b, 'th', { numeric: true, sensitivity: 'base' }))
    return names
  }, [billableJobs])

  const filteredBillableJobs = useMemo(() => {
    const q = jobSearch.trim().toLowerCase()
    return (billableJobs || []).filter((job: BillableJob) => {
      const jobName = String(job.boq_master?.item_name || '').toLowerCase()
      const plotName = String(job.plots?.name || '')
      const matchSearch = q.length === 0 || jobName.includes(q) || plotName.toLowerCase().includes(q)
      const matchPlot = !jobPlotFilter || plotName === jobPlotFilter
      return matchSearch && matchPlot
    })
  }, [billableJobs, jobSearch, jobPlotFilter])

  const handleSubmit = async () => {
    setError(null)

    if (!selectedProject || !selectedContractor) {
      setError('กรุณาเลือกโครงการและผู้รับเหมา')
      return
    }

    if (selectedJobs.size === 0 && adjustments.length === 0) {
      setError('กรุณาเลือกรายการงานที่ต้องการเบิก หรือเพิ่มรายการงานเพิ่ม/งานหักอย่างน้อย 1 รายการ')
      return
    }

    const jobsPayload: { id: string; progress_percent: number; request_amount: number }[] = []
    for (const [id, data] of selectedJobs.entries()) {
      const job = billableJobs.find((billableJob: BillableJob) => billableJob.id === id)
      if (!job) continue

      const progress = parseFloat(data.progress)
      const previousProgress = job.previous_progress ?? 0
      const jobName = job.boq_master?.item_name || 'งานหลัก'
      if (isNaN(progress)) {
        setError(`ความคืบหน้าของงาน "${jobName}" ไม่ถูกต้อง`)
        return
      }

      if (progress <= previousProgress) {
        setError(`ความคืบหน้าของงาน "${jobName}" ต้องมากกว่า ${previousProgress.toFixed(2)}%`)
        return
      }

      jobsPayload.push({
        id,
        progress_percent: progress,
        request_amount: data.request_amount,
      })
    }

    const dataToSubmit = {
      project_id: selectedProject,
      contractor_id: selectedContractor,
      billing_date: new Date().toISOString(),
      note,
      selected_jobs: jobsPayload,
      adjustments,
      total_work_amount: totalWorkAmount,
      total_add_amount: totalAddAmount,
      total_deduct_amount: totalDeductAmount,
    }

    setIsLoading(true)
    try {
      const result = editId
        ? await updateBillingRequest(editId, { ...dataToSubmit, type: 'progress' })
        : await createBillingRequest(dataToSubmit)
      if (!result.success) {
        setError(result.error)
        return
      }
      setSuccessNextPath(result.nextPath)
      setSubmittedData({ ...dataToSubmit, doc_no: result.doc_no, net_amount: netAmount })
      setShowSuccessModal(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save billing request')
    } finally {
      setIsLoading(false)
    }
  }

  const handleModalClose = () => {
    setShowSuccessModal(false)
    router.push(successNextPath)
  }

  return (
    <div className="container mx-auto p-4">
      {showSuccessModal && submittedData && (
        <Modal isOpen={showSuccessModal} onClose={handleModalClose}>
          <div className="p-4 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">ส่งคำขอสำเร็จ</h2>
            <p className="text-gray-600 mb-4">ใบขอเบิกเลขที่ #{submittedData.doc_no} ถูกส่งเพื่อรอการตรวจสอบแล้ว</p>
            <div className="bg-gray-50 p-4 rounded-lg text-left mb-6">
              <p><strong>โครงการ:</strong> {projects.find((project: ProjectOption) => project.id === submittedData.project_id)?.name}</p>
              <p><strong>ผู้รับเหมา:</strong> {contractors.find((contractor: ContractorOption) => contractor.id === submittedData.contractor_id)?.name}</p>
              <p className="mt-2 text-lg font-bold">ยอดขอเบิกรวม: <span className="text-blue-600">{formatCurrency(submittedData.net_amount)} บาท</span></p>
            </div>
            <button onClick={handleModalClose} className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">กลับไปที่หน้ารายการ</button>
          </div>
        </Modal>
      )}

      <h1 className="text-2xl font-bold mb-4">สร้างใบขอเบิก (สำหรับ Foreman)</h1>
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">โครงการ</label>
            <select value={selectedProject} onChange={(e) => setSelectedProject(e.target.value)} className="mt-1 block w-full p-2 border border-gray-300 rounded-md">
              <option value="">เลือกโครงการ</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">ผู้รับเหมา</label>
            <select value={selectedContractor} onChange={(e) => setSelectedContractor(e.target.value)} className="mt-1 block w-full p-2 border border-gray-300 rounded-md">
              <option value="">เลือกผู้รับเหมา</option>
              {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {billableJobs.length > 0 && (
          <div className="mt-6">
            <h2 className="text-xl font-semibold mb-2">งานที่สามารถเบิกได้</h2>
            <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-2">
              <input type="text" value={jobSearch} onChange={(e) => setJobSearch(e.target.value)} placeholder="ค้นหาชื่องานหรือแปลง..." className="w-full p-2 border border-gray-300 rounded-md" />
              <select value={jobPlotFilter} onChange={(e) => setJobPlotFilter(e.target.value)} className="w-full p-2 border border-gray-300 rounded-md">
                <option value="">ทุกแปลง</option>
                {adjustmentPlotOptions.map((plot) => <option key={plot} value={plot}>{plot}</option>)}
              </select>
              <button type="button" onClick={() => { setJobSearch(''); setJobPlotFilter('') }} className="px-3 py-2 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50">ล้างตัวกรอง</button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-[14px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left">เลือก</th>
                    <th className="px-4 py-3 text-left">ชื่องาน</th>
                    <th className="px-4 py-3 text-right">มูลค่าทั้งหมด</th>
                    <th className="px-4 py-3 text-right">เบิกแล้ว</th>
                    <th className="px-4 py-3 text-right">คงเหลือก่อนเบิก</th>
                    <th className="px-4 py-3 text-right">คืบหน้าเดิม %</th>
                    <th className="px-4 py-3 text-right">คืบหน้าปัจจุบัน %</th>
                    <th className="px-4 py-3 text-right">ยอดขอเบิก</th>
                    <th className="px-4 py-3 text-right">คงเหลือหลังเบิก</th>
                    <th className="px-4 py-3 text-center">วัสดุ</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredBillableJobs.map((job) => {
                    const selected = selectedJobs.get(job.id)
                    const requested = Number(selected?.request_amount || 0)
                    const remainingBefore = Math.max(0, Number(job.remaining || 0))
                    const remainingAfter = Math.max(0, remainingBefore - requested)
                    const historyRows = progressHistoryByJob[job.id] || []

                    return (
                      <Fragment key={job.id}>
                        <tr key={job.id}>
                          <td className="px-4 py-3"><input type="checkbox" onChange={() => handleJobSelection(job.id, job)} checked={selectedJobs.has(job.id)} /></td>
                          <td className="px-4 py-3">{job.boq_master?.item_name || 'งานหลัก'} ({job.plots?.name || '-'})</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(job.totalBoq)}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(job.paid)}</td>
                          <td className="px-4 py-3 text-right font-medium text-slate-700">{formatCurrency(remainingBefore)}</td>
                          <td className="px-4 py-3 text-right">{(job.previous_progress ?? 0).toFixed(2)}%</td>
                          <td className="px-4 py-3 text-right">
                            {selectedJobs.has(job.id) && (
                              <input
                                type="number"
                                className="w-24 p-1 border border-gray-300 rounded-md text-right"
                                value={selected?.progress || ''}
                                onChange={(e) => handleProgressChange(job.id, job, e.target.value)}
                                min={(job.previous_progress ?? 0).toFixed(2)}
                                max="100"
                                step="0.01"
                                placeholder={(job.previous_progress ?? 0).toFixed(2)}
                              />
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">{formatCurrency(requested)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-emerald-700">{formatCurrency(remainingAfter)}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                setMaterialsJob({ id: job.id, label: job.boq_master?.item_name || 'งาน' })
                              }
                              className="rounded p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                              title="บันทึกวัสดุ"
                            >
                              <Boxes className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>

                        {selectedJobs.has(job.id) && (
                          <tr>
                            <td colSpan={10} className="px-4 pb-4 pt-1">
                              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <div className="text-xs font-semibold text-slate-700 mb-2">ประวัติความคืบหน้า (แสดงเฉพาะงานที่เลือก)</div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-sm border border-slate-200 bg-white">
                                    <thead className="bg-slate-100">
                                      <tr>
                                        <th className="px-2 py-1 text-left">เลขที่ใบเบิก</th>
                                        <th className="px-2 py-1 text-left">วันที่</th>
                                        <th className="px-2 py-1 text-left">สถานะ</th>
                                        <th className="px-2 py-1 text-right">ยอดสะสมก่อนเบิก</th>
                                        <th className="px-2 py-1 text-right">ยอดสะสมหลังเบิก</th>
                                        <th className="px-2 py-1 text-right">คงเหลือก่อนเบิก</th>
                                        <th className="px-2 py-1 text-right">คงเหลือหลังเบิก</th>
                                        <th className="px-2 py-1 text-right">%</th>
                                        <th className="px-2 py-1 text-right">ยอดเบิก</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {historyRows.length === 0 ? (
                                        <tr>
                                          <td colSpan={9} className="px-2 py-2 text-center text-slate-400">ยังไม่มีประวัติ</td>
                                        </tr>
                                      ) : (() => {
                                        const asc = [...historyRows].sort((a: ProgressHistoryItem, b: ProgressHistoryItem) => {
                                          const ta = new Date(a.billing_date || a.created_at || 0).getTime()
                                          const tb = new Date(b.billing_date || b.created_at || 0).getTime()
                                          return ta - tb
                                        })
                                        let paidSoFar = 0
                                        const withBalances = asc.map((h: ProgressHistoryItem) => {
                                          const beforePaid = paidSoFar
                                          const amount = Number(h.amount || 0)
                                          const afterPaid = beforePaid + amount
                                          paidSoFar = afterPaid
                                          return { ...h, beforePaid, afterPaid }
                                        }).reverse()
                                        return withBalances.map((h: ProgressHistoryItem & { beforePaid: number; afterPaid: number }) => (
                                          <tr key={h.id} className="border-t border-slate-100">
                                            <td className="px-2 py-1">#{String(h.doc_no || '-').padStart(4, '0')}</td>
                                            <td className="px-2 py-1">{h.billing_date ? new Date(h.billing_date).toLocaleDateString('th-TH') : (h.created_at ? new Date(h.created_at).toLocaleDateString('th-TH') : '-')}</td>
                                            <td className="px-2 py-1">{h.status || '-'}</td>
                                            <td className="px-2 py-1 text-right">{formatCurrency(h.beforePaid || 0)}</td>
                                            <td className="px-2 py-1 text-right">{formatCurrency(h.afterPaid || 0)}</td>
                                            <td className="px-2 py-1 text-right">{formatCurrency(Math.max(0, Number(job.totalBoq || 0) - Number(h.beforePaid || 0)))}</td>
                                            <td className="px-2 py-1 text-right">{formatCurrency(Math.max(0, Number(job.totalBoq || 0) - Number(h.afterPaid || 0)))}</td>
                                            <td className="px-2 py-1 text-right">{h.progress_percent == null ? '-' : `${Number(h.progress_percent).toFixed(2)}%`}</td>
                                            <td className="px-2 py-1 text-right">{formatCurrency(h.amount || 0)}</td>
                                          </tr>
                                        ))
                                      })()}
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

                  {filteredBillableJobs.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-6 py-4 text-center text-slate-400">ไม่พบงานตามตัวกรอง</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-2">รายการเพิ่มเติม (งานเพิ่ม/งานหัก)</h2>
          <AdjustmentLineItems
            adjustments={adjustments}
            plotOptions={adjustmentPlotOptions}
            onChange={handleAdjustmentChange}
            onAdd={addAdjustment}
            onRemove={removeAdjustment}
            totalAddAmount={totalAddAmount}
            totalDeductAmount={totalDeductAmount}
            netLabel="ยอดสุทธิ DC"
            netValue={totalAddAmount - totalDeductAmount}
            theme="slate"
          />
        </div>

        <div className="mt-6 bg-slate-50 p-4 rounded-lg border border-slate-200">
          <h2 className="text-xl font-semibold mb-4">สรุปยอด</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">หมายเหตุ (ถึง PM)</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 block w-full p-2 border border-gray-300 rounded-md" placeholder="ใส่ข้อความเพิ่มเติมถึงผู้ตรวจสอบ..." />
            </div>
            <div className="space-y-1">
              {/* Summary breakdown table */}
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-slate-100">
                      <td className="px-4 py-2 text-slate-600">ยอดเบิกตามเนื้องานหลัก</td>
                      <td className="px-4 py-2 text-right font-semibold text-slate-800">{formatCurrency(totalWorkAmount)}</td>
                    </tr>
                    <tr className="border-b border-slate-100 bg-green-50/50">
                      <td className="px-4 py-2 text-slate-600">+ งานเพิ่ม ({adjustments.filter(a => a.type === 'addition').length} รายการ)</td>
                      <td className="px-4 py-2 text-right font-semibold text-green-700">+{formatCurrency(totalAddAmount)}</td>
                    </tr>
                    <tr className="border-b border-slate-100 bg-red-50/50">
                      <td className="px-4 py-2 text-slate-600">− งานหัก ({adjustments.filter(a => a.type === 'deduction').length} รายการ)</td>
                      <td className="px-4 py-2 text-right font-semibold text-red-600">-{formatCurrency(totalDeductAmount)}</td>
                    </tr>
                    <tr className="bg-blue-50">
                      <td className="px-4 py-3 text-base font-bold text-slate-800">ยอดรวมขอเบิก</td>
                      <td className="px-4 py-3 text-right text-2xl font-bold text-blue-700">{formatCurrency(netAmount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {error && <p className="mt-4 text-red-500">{error}</p>}

        <div className="mt-6 flex justify-end">
          <button onClick={handleSubmit} disabled={isLoading || !selectedProject || !selectedContractor} className="px-6 py-3 bg-blue-600 text-white font-bold rounded-md hover:bg-blue-700 disabled:bg-gray-400">
            {isLoading ? 'กำลังส่ง...' : 'ส่งใบขอเบิกเพื่อตรวจสอบ'}
          </button>
        </div>
      </Card>

      {materialsJob && (
        <JobMaterialLogModal
          isOpen={Boolean(materialsJob)}
          onClose={() => setMaterialsJob(null)}
          jobAssignmentId={materialsJob.id}
          jobLabel={materialsJob.label}
        />
      )}
    </div>
  )
}
