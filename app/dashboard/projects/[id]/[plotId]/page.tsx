'use client'

import { useEffect, useState, useTransition } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Hammer, Pencil, RefreshCw, User } from 'lucide-react'
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
import { formatCurrency } from '@/lib/currency'

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
  code?: string | null
  projects?: {
    name?: string | null
    location?: string | null
  } | null
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

  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  const getHouseModelLabel = (model: HouseModel) => {
    const projectName = model?.projects?.name
    const projectLocation = model?.projects?.location
    const scopeLabel = projectName
      ? [projectLocation, projectName].filter(Boolean).join(' - ')
      : 'ทุกโครงการ'
    const codeLabel = model?.code ? ` (${model.code})` : ''

    return `${model?.name || 'ไม่ระบุแบบบ้าน'}${codeLabel} - ${scopeLabel}`
  }

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
    startTransition(async () => {
      await updateAgreedPricePerUnit(job.id, parsed, plotId, projectId)
    })
  }

  const handleResetVariablePrice = (job: any) => {
    setPriceDrafts((prev) => ({ ...prev, [job.id]: '' }))
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, agreed_price_per_unit: null } : j)))
    startTransition(async () => {
      await updateAgreedPricePerUnit(job.id, null, plotId, projectId)
    })
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

  const handleUpdatePlot = async (formData: FormData) => {
    setIsEditModalOpen(false)
    startTransition(async () => {
      await updatePlot(plotId, projectId, formData)
    })
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
                        {job.boq_master?.quantity} {job.boq_master?.unit} x {formatCurrency(job.boq_master?.price_per_unit)}
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
                            ? `ใช้ราคาตกลง: ฿${formatCurrency(Number(effectivePrice))}`
                            : `ใช้ราคา BOQ: ฿${formatCurrency(Number(effectivePrice))}`}
                        </div>
                      </div>
                    </td>

                    <td className="px-4 py-3 text-right text-slate-600 font-medium">฿{formatCurrency(totalBoq)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${isOverBudget ? 'text-red-600' : 'text-emerald-600'}`}>
                      ฿{formatCurrency(paid)}
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
                  {getHouseModelLabel(m)}
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

    </div>
  )
}
