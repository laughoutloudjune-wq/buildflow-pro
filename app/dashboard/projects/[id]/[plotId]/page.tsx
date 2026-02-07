'use client'

import { useEffect, useState, useTransition } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Banknote, Calculator, Hammer, Loader2, Pencil, Plus, RefreshCw, Trash2, User } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import {
  assignContractor,
  getJobAssignments,
  getPlotById,
  syncPlotJobs,
  updateAgreedPricePerUnit,
  updateJobStatus,
} from '@/actions/job-actions'
import { updatePlot } from '@/actions/plot-actions'
import { getHouseModels } from '@/actions/boq-actions'
import { getContractors } from '@/actions/contractor-actions'
import { createPayment, deletePayment } from '@/actions/payment-actions'

type Plot = {
  id: string
  name: string
  house_model_id: string
  house_models: { name: string } | null
}

type Job = any

type Contractor = {
  id: string
  name: string
}

type HouseModel = {
  id: string
  name: string
}

export default function PlotDetailPage() {
  const params = useParams()
  const projectId = params.id as string
  const plotId = params.plotId as string

  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [plot, setPlot] = useState<Plot | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [houseModels, setHouseModels] = useState<HouseModel[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({})

  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false)

  const [payAmount, setPayAmount] = useState('')
  const [payPercent, setPayPercent] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadData = async () => {
    try {
      setIsLoading(true)
      const [pData, jData, cData, hmData] = await Promise.all([
        getPlotById(plotId),
        getJobAssignments(plotId),
        getContractors(),
        getHouseModels(),
      ])

      setPlot(pData)
      setJobs(jData || [])
      setContractors(cData || [])
      setHouseModels(hmData || [])
      setPriceDrafts(
        (jData || []).reduce((acc: Record<string, string>, job: any) => {
          acc[job.id] = job.agreed_price_per_unit == null ? '' : String(job.agreed_price_per_unit)
          return acc
        }, {})
      )
    } catch (error) {
      console.error(error)
    } finally {
      setIsLoading(false)
    }
  }

  const updateJobWithNewPayment = (jobId: string, newPayment: any) => {
    setJobs((prevJobs) =>
      prevJobs.map((job) => {
        if (job.id === jobId) {
          const currentPayments = job.payments || []
          return { ...job, payments: [newPayment, ...currentPayments] }
        }
        return job
      })
    )

    if (selectedJob && selectedJob.id === jobId) {
      const currentPayments = selectedJob.payments || []
      setSelectedJob({ ...selectedJob, payments: [newPayment, ...currentPayments] })
    }
  }

  const removePaymentFromJob = (jobId: string, paymentId: string) => {
    setJobs((prevJobs) =>
      prevJobs.map((job) => {
        if (job.id === jobId) {
          return { ...job, payments: job.payments.filter((p: any) => p.id !== paymentId) }
        }
        return job
      })
    )

    if (selectedJob && selectedJob.id === jobId) {
      setSelectedJob({ ...selectedJob, payments: selectedJob.payments.filter((p: any) => p.id !== paymentId) })
    }
  }

  const handleAssign = (jobId: string, contractorId: string) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, contractor_id: contractorId || null } : j)))
    startTransition(async () => {
      await assignContractor(jobId, contractorId, plotId, projectId)
    })
  }

  const handleStatusChange = (jobId: string, newStatus: string) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: newStatus } : j)))
    startTransition(async () => {
      await updateJobStatus(jobId, newStatus, plotId, projectId)
    })
  }

  const handleSync = () => {
    if (!plot) return
    if (!confirm('ต้องการดึงรายการ BOQ ล่าสุดมาเพิ่มใช่ไหม?')) return
    startTransition(async () => {
      await syncPlotJobs(plotId, plot.house_model_id, projectId)
      await loadData()
    })
  }

  const handlePriceDraftChange = (jobId: string, value: string) => {
    setPriceDrafts((prev) => ({ ...prev, [jobId]: value }))
  }

  const handleSaveVariablePrice = (job: any) => {
    const raw = (priceDrafts[job.id] ?? '').trim()

    if (raw === '') {
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, agreed_price_per_unit: null } : j)))
      if (selectedJob?.id === job.id) setSelectedJob({ ...selectedJob, agreed_price_per_unit: null })
      startTransition(async () => {
        await updateAgreedPricePerUnit(job.id, null, plotId, projectId)
      })
      return
    }

    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 0) {
      alert('กรุณาใส่ราคาต่อหน่วยที่ถูกต้อง')
      return
    }

    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, agreed_price_per_unit: parsed } : j)))
    if (selectedJob?.id === job.id) setSelectedJob({ ...selectedJob, agreed_price_per_unit: parsed })
    startTransition(async () => {
      await updateAgreedPricePerUnit(job.id, parsed, plotId, projectId)
    })
  }

  const handleResetVariablePrice = (job: any) => {
    setPriceDrafts((prev) => ({ ...prev, [job.id]: '' }))
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, agreed_price_per_unit: null } : j)))
    if (selectedJob?.id === job.id) setSelectedJob({ ...selectedJob, agreed_price_per_unit: null })
    startTransition(async () => {
      await updateAgreedPricePerUnit(job.id, null, plotId, projectId)
    })
  }

  const openPaymentModal = (job: any) => {
    const sortedJob = {
      ...job,
      payments:
        job.payments?.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) || [],
    }
    setSelectedJob(sortedJob)
    setPayAmount('')
    setPayPercent('')
    setNote('')
    setIsPaymentModalOpen(true)
  }

  const getJobFinancials = (job: any) => {
    if (!job) return { totalBoq: 0, paid: 0, remaining: 0, paidPercent: 0, effectivePrice: 0 }

    const effectivePrice = (job.agreed_price_per_unit ?? job.boq_master?.price_per_unit) || 0
    const totalBoq = (job.boq_master?.quantity || 0) * effectivePrice
    const paid = job.payments?.reduce((sum: number, p: any) => sum + (p.amount || 0), 0) || 0
    const remaining = totalBoq - paid
    const paidPercent = totalBoq > 0 ? (paid / totalBoq) * 100 : 0

    return { totalBoq, paid, remaining, paidPercent, effectivePrice }
  }

  const handlePercentChange = (val: string) => {
    setPayPercent(val)
    if (!val || !selectedJob) return

    const percent = parseFloat(val)
    const { totalBoq, paidPercent } = getJobFinancials(selectedJob)
    if (!isNaN(percent)) {
      const calculatedAmount = (totalBoq * percent) / 100
      setPayAmount(calculatedAmount.toFixed(2))
      const newTotalPercent = paidPercent + percent
      setNote(`เบิกงวดงาน ${percent}% (สะสม ${newTotalPercent.toFixed(1)}%)`)
    }
  }

  const handlePayRemaining = () => {
    if (!selectedJob) return
    const { remaining, totalBoq } = getJobFinancials(selectedJob)
    setPayAmount(remaining.toFixed(2))
    const remainingPercent = totalBoq > 0 ? (remaining / totalBoq) * 100 : 0
    setPayPercent(remainingPercent.toFixed(2))
    setNote('ปิดงวดงานสุดท้าย (100%)')
  }

  const handlePaymentSubmit = async (formData: FormData) => {
    if (!selectedJob) return
    setIsSubmittingPayment(true)

    formData.append('job_assignment_id', selectedJob.id)
    formData.set('amount', payAmount)
    formData.set('note', note)

    try {
      const newPayment = await createPayment(formData, projectId, plotId)
      if (newPayment) {
        updateJobWithNewPayment(selectedJob.id, newPayment)
        setPayAmount('')
        setPayPercent('')
        setNote('')
      }
    } catch (error) {
      console.error(error)
      alert('เกิดข้อผิดพลาดในการบันทึก')
    } finally {
      setIsSubmittingPayment(false)
    }
  }

  const handleUpdatePlot = async (formData: FormData) => {
    setIsEditModalOpen(false)
    startTransition(async () => {
      await updatePlot(plotId, projectId, formData)
    })
  }

  const handleDeletePayment = async (paymentId: string) => {
    if (!selectedJob) return
    if (!confirm('ลบรายการจ่ายเงินนี้?')) return

    try {
      await deletePayment(paymentId, projectId, plotId)
      removePaymentFromJob(selectedJob.id, paymentId)
    } catch (error) {
      console.error(error)
      alert('ลบไม่สำเร็จ')
    }
  }

  if (isLoading) return <div className="p-8 text-center text-slate-500">กำลังโหลดข้อมูล...</div>
  if (!plot) return <div className="p-8 text-center text-red-500">ไม่พบข้อมูลแปลง</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <button
          onClick={() => router.push(`/dashboard/projects/${projectId}`)}
          className="text-sm text-slate-500 hover:text-indigo-600 w-fit flex gap-1 items-center"
        >
          <ArrowLeft className="h-4 w-4" /> กลับหน้ารายการ
        </button>

        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <Hammer className="text-indigo-600" /> แปลง {plot.name}
              </h1>
              <button onClick={() => setIsEditModalOpen(true)} className="text-slate-400 hover:text-indigo-600">
                <Pencil className="h-4 w-4" />
              </button>
            </div>
            <p className="text-sm text-slate-500">แบบบ้าน: {plot.house_models?.name}</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSync}
              disabled={isPending}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition"
            >
              <RefreshCw className={`h-3 w-3 ${isPending ? 'animate-spin' : ''}`} /> ดึง BOQ
            </button>
            <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-sm font-bold border border-slate-200">
              งานทั้งหมด {jobs.length} รายการ
            </span>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-700 border-b">
              <tr>
                <th className="px-4 py-3 font-semibold">รายการงาน</th>
                <th className="px-4 py-3 font-semibold w-[220px]">Variable Price / Unit</th>
                <th className="px-4 py-3 font-semibold text-right">งบประมาณ (BOQ)</th>
                <th className="px-4 py-3 font-semibold text-right">จ่ายแล้ว</th>
                <th className="px-4 py-3 font-semibold w-[200px]">ผู้รับเหมา</th>
                <th className="px-4 py-3 font-semibold w-[120px]">สถานะ</th>
                <th className="px-4 py-3 font-semibold text-center w-[50px]">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {jobs.map((job) => {
                const { totalBoq, paid, effectivePrice } = getJobFinancials(job)
                const isOverBudget = paid > totalBoq

                return (
                  <tr key={job.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{job.boq_master?.item_name}</div>
                      <div className="text-xs text-slate-400">
                        {job.boq_master?.quantity} {job.boq_master?.unit} x {job.boq_master?.price_per_unit?.toLocaleString()}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder={String(job.boq_master?.price_per_unit || 0)}
                            value={priceDrafts[job.id] ?? ''}
                            onChange={(e) => handlePriceDraftChange(job.id, e.target.value)}
                            className="w-28 rounded border border-slate-300 px-2 py-1 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveVariablePrice(job)}
                            disabled={isPending}
                            className="rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResetVariablePrice(job)}
                            disabled={isPending}
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                          >
                            Reset
                          </button>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {job.agreed_price_per_unit != null
                            ? `ใช้ราคาตกลง: ฿${Number(effectivePrice).toLocaleString()}`
                            : `ใช้ราคา BOQ: ฿${Number(effectivePrice).toLocaleString()}`}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right text-slate-600 font-medium">฿{totalBoq.toLocaleString()}</td>
                    <td className={`px-4 py-3 text-right font-bold ${isOverBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                      ฿{paid.toLocaleString()}
                    </td>

                    <td className="px-4 py-3">
                      <div className="relative">
                        <User className="absolute left-2 top-2.5 h-3 w-3 text-slate-400" />
                        <select
                          value={job.contractor_id || ''}
                          onChange={(e) => handleAssign(job.id, e.target.value)}
                          className={`w-full pl-7 pr-2 py-1.5 rounded border text-xs cursor-pointer outline-none ${
                            job.contractor_id ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200'
                          }`}
                        >
                          <option value="">-- ว่าง --</option>
                          {contractors.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <select
                        value={job.status}
                        onChange={(e) => handleStatusChange(job.id, e.target.value)}
                        disabled={!job.contractor_id}
                        className={`w-full px-2 py-1.5 rounded text-xs font-bold border-0 cursor-pointer ${
                          job.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-700'
                            : job.status === 'in_progress'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        <option value="pending">รอเริ่ม</option>
                        <option value="in_progress">กำลังทำ</option>
                        <option value="completed">เสร็จสิ้น</option>
                      </select>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => openPaymentModal(job)}
                        className="p-1.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition"
                        title="บันทึกการจ่ายเงิน"
                      >
                        <Banknote className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="แก้ไขรายละเอียดแปลง">
        <form action={handleUpdatePlot} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อแปลง</label>
            <input name="name" required className="w-full" defaultValue={plot.name} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">แบบบ้าน</label>
            <select name="house_model_id" required className="w-full" defaultValue={plot.house_model_id}>
              <option value="" disabled>
                -- เลือกแบบบ้าน --
              </option>
              {houseModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setIsEditModalOpen(false)} className="btn-secondary">
              ยกเลิก
            </button>
            <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 shadow transition">
              บันทึก
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        title={`จัดการงวดงาน: ${selectedJob?.boq_master?.item_name || ''}`}
      >
        {selectedJob && (() => {
          const { totalBoq, paid, remaining, paidPercent, effectivePrice } = getJobFinancials(selectedJob)

          return (
            <div className="space-y-5">
              <div className="rounded border border-indigo-100 bg-indigo-50 p-2 text-xs text-indigo-700">
                Effective price per unit: ฿{Number(effectivePrice).toLocaleString()}{' '}
                {selectedJob?.agreed_price_per_unit != null ? '(variable price)' : '(BOQ default)'}
              </div>

              <div className="grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-100 text-center">
                <div>
                  <div className="text-xs text-slate-500 mb-1">งบ BOQ</div>
                  <div className="text-sm font-bold text-slate-800">฿{totalBoq.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-emerald-600 mb-1">จ่ายแล้ว ({paidPercent.toFixed(0)}%)</div>
                  <div className="text-sm font-bold text-emerald-600">฿{paid.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">คงเหลือ</div>
                  <div className={`text-sm font-bold ${remaining < 0 ? 'text-red-500' : 'text-slate-800'}`}>
                    ฿{remaining.toLocaleString()}
                  </div>
                </div>
              </div>

              <form action={handlePaymentSubmit} className="space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-sm font-medium text-slate-800 flex items-center gap-2">
                      <Calculator className="h-4 w-4 text-indigo-500" /> คำนวณยอดเบิกงวดนี้
                    </h4>
                    <button type="button" onClick={handlePayRemaining} className="text-xs text-indigo-600 hover:underline">
                      เบิกส่วนที่เหลือทั้งหมด
                    </button>
                  </div>

                  <div className="grid grid-cols-12 gap-3 items-end">
                    <div className="col-span-4">
                      <label className="text-xs text-slate-500 mb-1 block">ความคืบหน้า (%)</label>
                      <div className="relative">
                        <input
                          type="number"
                          placeholder="0"
                          value={payPercent}
                          onChange={(e) => handlePercentChange(e.target.value)}
                          className="w-full text-sm border p-2 rounded pr-6 focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                        <span className="absolute right-2 top-2 text-slate-400 text-xs">%</span>
                      </div>
                    </div>

                    <div className="col-span-8">
                      <label className="text-xs text-slate-500 mb-1 block">จำนวนเงิน (บาท)</label>
                      <input
                        type="number"
                        step="0.01"
                        name="amount"
                        required
                        placeholder="0.00"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        className="w-full text-sm border p-2 rounded font-bold text-emerald-600 bg-emerald-50 focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">วันที่จ่าย</label>
                    <input type="date" name="payment_date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full text-sm border p-2 rounded" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">บันทึกช่วยจำ</label>
                    <input
                      name="note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="เช่น เบิกงวดที่ 1"
                      className="w-full text-sm border p-2 rounded"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <button type="button" onClick={() => setIsPaymentModalOpen(false)} className="btn-secondary text-sm">
                    ปิด
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingPayment}
                    className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded text-sm hover:bg-emerald-700 shadow-sm disabled:opacity-50"
                  >
                    {isSubmittingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    ยืนยันจ่ายเงิน
                  </button>
                </div>
              </form>

              {selectedJob.payments?.length > 0 && (
                <div className="pt-2">
                  <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">ประวัติการเบิกจ่าย</h4>
                  <div className="space-y-2 max-h-[120px] overflow-y-auto bg-slate-50 p-2 rounded border">
                    {selectedJob.payments.map((p: any) => (
                      <div key={p.id} className="flex justify-between items-center text-xs bg-white p-2 rounded shadow-sm">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-700">฿{p.amount.toLocaleString()}</span>
                          <span className="text-slate-400">{p.note || '-'}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-300">{new Date(p.payment_date).toLocaleDateString('th-TH')}</span>
                          <button onClick={() => handleDeletePayment(p.id)} className="text-slate-300 hover:text-red-500">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
