'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { getBillingById, approveBilling, rejectBilling, deleteBilling } from '@/actions/billing-actions'
import { getOrganizationSettings } from '@/actions/settings-actions'
import { Card } from '@/components/ui/Card'
import { BillingPdf } from '@/components/pdf/BillingPdf'
import { Plus, Trash2, Edit, Printer, Loader2 } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

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
type Job = NonNullable<BillingData>['billing_jobs'][0]
type Adjustment = {
  id?: string
  type: 'addition' | 'deduction'
  description: string
  unit: string
  quantity: number
  unit_price: number
}

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

  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
          setAdjustments(Array.isArray(billingData.billing_adjustments) ? billingData.billing_adjustments : [])
          setWhtPercent(billingData.wht_percent || settingsData?.default_wht || 0)
          setRetentionPercent(billingData.retention_percent || settingsData?.default_retention || 0)
          if (billingData.billing_date) {
            setBillingDate(new Date(billingData.billing_date).toISOString().split('T')[0])
          }
        } else {
          setError('ไม่พบใบเบิกนี้')
        }
        setSettings(settingsData)
      } catch (e: any) {
        setError(e.message)
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
      .map((j: any) => j.job_assignments?.plots?.name)
      .filter(Boolean)
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

  const handleAdjustmentChange = (index: number, field: keyof Adjustment, value: any) => {
    const next = [...adjustments]
    ;(next[index] as any)[field] = value
    setAdjustments(next)
  }

  const addAdjustment = (type: 'addition' | 'deduction') => {
    setAdjustments([...adjustments, { type, description: '', unit: 'หน่วย', quantity: 1, unit_price: 0 }])
  }

  const removeAdjustment = (index: number) => {
    setAdjustments(adjustments.filter((_, i) => i !== index))
  }

  const { totalWorkAmount, totalAddAmount, totalDeductAmount, grossAmount, netAmount, whtAmount, retentionAmount } = useMemo(() => {
    const totalWorkAmount = jobs.reduce((sum, job) => sum + (job.amount || 0), 0)
    const totalAddAmount = adjustments.filter((adj) => adj.type === 'addition').reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)
    const totalDeductAmount = adjustments.filter((adj) => adj.type === 'deduction').reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)

    const whtAmount = totalAddAmount * (whtPercent / 100)
    const retentionAmount = totalWorkAmount * (retentionPercent / 100)

    const grossAmount = totalWorkAmount + totalAddAmount - totalDeductAmount
    const netAmount = (totalWorkAmount - retentionAmount) + (totalAddAmount - whtAmount) - totalDeductAmount

    return { totalWorkAmount, totalAddAmount, totalDeductAmount, grossAmount, netAmount, whtAmount, retentionAmount }
  }, [jobs, adjustments, whtPercent, retentionPercent])

  const handleApprove = async () => {
    setError(null)
    setIsSubmitting(true)
    try {
      const approvalData = {
        billing_date: billingDate,
        selected_jobs: jobs.map((j) => ({
          job_assignment_id: j.job_assignments.id,
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
      alert('อนุมัติใบเบิกเรียบร้อยแล้ว')
      router.push('/dashboard/billing')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleReject = async () => {
    const note = prompt('กรุณาใส่เหตุผลที่ปฏิเสธ (ไม่บังคับ):')
    if (note === null) return
    setError(null)
    setIsSubmitting(true)
    try {
      await rejectBilling(id, note || undefined)
      alert('ปฏิเสธใบเบิกเรียบร้อยแล้ว')
      router.push('/dashboard/billing')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (isSubmitting) return
    const confirmDelete = window.confirm('ต้องการลบใบขอเบิกนี้ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้')
    if (!confirmDelete) return

    setIsSubmitting(true)
    try {
      await deleteBilling(id)
      alert('ลบใบขอเบิกเรียบร้อยแล้ว')
      router.push('/dashboard/billing')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setIsSubmitting(false)
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
  if (error) return <p className="text-red-500 text-center p-8">{error}</p>
  if (!billing) return <p className="text-center p-8">ไม่พบข้อมูลใบเบิก</p>

  return (
    <div className="container mx-auto p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold mb-0">ตรวจสอบใบขอเบิก #{billing.doc_no}</h1>
        <button onClick={handleDelete} className="flex items-center gap-2 text-sm text-red-600 hover:text-red-800">
          <Trash2 className="h-4 w-4" /> ลบใบคำขอ
        </button>
      </div>

      <div className="flex border-b">
        <button
          onClick={() => setActiveTab('edit')}
          className={`flex-1 py-3 text-sm font-bold transition flex items-center justify-center gap-2 ${
            activeTab === 'edit' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          <Edit className="h-4 w-4" /> แก้ไขข้อมูล
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={`flex-1 py-3 text-sm font-bold transition flex items-center justify-center gap-2 ${
            activeTab === 'preview' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50' : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          <Printer className="h-4 w-4" /> ตัวอย่างก่อนพิมพ์
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
              <p><span className="font-semibold">ผู้ส่งคำขอ:</span> {billing.submitted_by_user?.full_name || billing.submitted_by || 'N/A'}</p>
              <p><span className="font-semibold">วันที่ส่ง:</span> {new Date(billing.created_at).toLocaleString('th-TH')}</p>
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
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Foreman %</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">PM %</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">ยอดเงิน</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {jobs.map((job) => (
                      <tr key={job.id}>
                        <td className="px-6 py-4">
                          <div>{job.job_assignments.boq_master.item_name}</div>
                          <div className="text-xs text-slate-500">แปลง {job.job_assignments.plots?.name || '-'}</div>
                        </td>
                        <td className="px-6 py-4 text-right">{formatCurrency(job.totalBoq)}</td>
                        <td className="px-6 py-4 text-right">{formatCurrency(job.paid)}</td>
                        <td className="px-6 py-4 text-right font-semibold text-blue-600">{billing.billing_jobs.find((bj: any) => bj.id === job.id)?.progress_percent?.toFixed(2)}%</td>
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
                      </tr>
                    ))}
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
                <div className="col-span-4"><input type="text" placeholder="รายละเอียด" value={adj.description} onChange={(e) => handleAdjustmentChange(index, 'description', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" /></div>
                <div className="col-span-1"><input type="text" placeholder="หน่วย" value={adj.unit} onChange={(e) => handleAdjustmentChange(index, 'unit', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" /></div>
                <div className="col-span-2"><input type="number" placeholder="จำนวน" value={adj.quantity} onChange={(e) => handleAdjustmentChange(index, 'quantity', parseFloat(e.target.value))} className="w-full p-2 border border-gray-300 rounded-md" /></div>
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
                <div><label className="block text-sm font-medium text-gray-700">หัก ณ ที่จ่าย (WHT) %</label><input type="number" value={whtPercent} onChange={(e) => setWhtPercent(parseFloat(e.target.value))} className="mt-1 block w-full p-2 border border-gray-300 rounded-md" /></div>
                <div><label className="block text-sm font-medium text-gray-700">ประกันผลงาน (Retention) %</label><input type="number" value={retentionPercent} onChange={(e) => setRetentionPercent(parseFloat(e.target.value))} className="mt-1 block w-full p-2 border border-gray-300 rounded-md" /></div>
              </div>
              <div className="mt-4 p-4 bg-white rounded-lg border text-right space-y-1">
                <p className="text-sm text-gray-600">ยอดเบิกตามเนื้องาน: <span className="font-semibold text-gray-800 w-32 inline-block">{formatCurrency(totalWorkAmount)}</span></p>
                <p className="text-sm text-gray-600">ยอดงานเพิ่ม: <span className="font-semibold text-green-600 w-32 inline-block">{formatCurrency(totalAddAmount)}</span></p>
                <p className="text-sm text-gray-600">ยอดงานหัก: <span className="font-semibold text-red-600 w-32 inline-block">-{formatCurrency(totalDeductAmount)}</span></p>
                <hr className="my-1" />
                <p className="font-semibold">ยอดรวมก่อนหักภาษี: <span className="w-32 inline-block">{formatCurrency(grossAmount)}</span></p>
                <p className="text-sm text-gray-600">หัก ณ ที่จ่าย ({whtPercent}% จากยอดงานเพิ่ม): <span className="font-semibold text-red-600 w-32 inline-block">-{formatCurrency(whtAmount)}</span></p>
                <p className="text-sm text-gray-600">หักประกันผลงาน ({retentionPercent}% จากยอดงานหลัก): <span className="font-semibold text-red-600 w-32 inline-block">-{formatCurrency(retentionAmount)}</span></p>
                <hr className="my-1" />
                <p className="font-bold text-xl">ยอดสุทธิที่ต้องจ่าย (Net): <span className="text-2xl text-emerald-700">{formatCurrency(netAmount)}</span></p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-4">
              <button onClick={handleReject} disabled={isSubmitting} className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400 font-semibold">
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
    </div>
  )
}
