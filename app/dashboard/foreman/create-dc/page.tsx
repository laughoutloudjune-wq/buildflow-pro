'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/client'
import { getBillingOptions, createBillingRequest, getBillingById, updateBillingRequest } from '@/actions/billing-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { Plus, Trash2, Camera, CheckCircle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { formatCurrency } from '@/lib/currency'
import type { BillingAdjustmentInput, BillingPayload } from '@/lib/billing'
import type {
  BillingAdjustmentForm,
  BillingAdjustmentRecord,
  ContractorOption,
  PlotOption,
  ProjectOption,
} from '@/lib/types/billing'

type Adjustment = BillingAdjustmentForm

const DC_REASONS = ['Owner Request', 'Site Condition', 'Design Error', 'Scope Change', 'Other']

export default function CreateExtraWorkPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get('editId')

  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [contractors, setContractors] = useState<ContractorOption[]>([])
  const [plots, setPlots] = useState<PlotOption[]>([])

  const [selectedProject, setSelectedProject] = useState('')
  const [selectedContractor, setSelectedContractor] = useState('')
  const [selectedPlot, setSelectedPlot] = useState('')

  const [reason, setReason] = useState(DC_REASONS[0])
  const [note, setNote] = useState('')
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [billingDate, setBillingDate] = useState(new Date().toISOString())

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [successNextPath, setSuccessNextPath] = useState('/dashboard/foreman/history')
  const [docNo, setDocNo] = useState<string | number>('')
  const [existingAttachmentUrls, setExistingAttachmentUrls] = useState<string[]>([])

  useEffect(() => {
    async function fetchOptions() {
      const { projects, contractors } = await getBillingOptions()
      setProjects(projects || [])
      setContractors(contractors || [])
    }
    fetchOptions()
  }, [])

  useEffect(() => {
    if (!editId) return
    async function fetchForEdit() {
      try {
        const billingId = editId as string
        const billing = await getBillingById(billingId)
        if (!billing) return
        setSelectedProject(billing.project_id || '')
        setSelectedContractor(billing.contractor_id || '')
        setSelectedPlot(billing.plot_id || '')
        setReason(billing.reason_for_dc || DC_REASONS[0])
        setNote(billing.note || '')
        setBillingDate(billing.billing_date || billingDate)
        setExistingAttachmentUrls(Array.isArray(billing.attachment_urls) ? billing.attachment_urls : [])
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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load DC request')
      }
    }
    fetchForEdit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  useEffect(() => {
    if (!selectedProject) {
      setPlots([])
      setSelectedPlot('')
      return
    }
    getPlotsByProjectId(selectedProject).then((data) => setPlots(data || []))
  }, [selectedProject])

  const handleAdjustmentChange = (index: number, field: keyof Adjustment, value: Adjustment[keyof Adjustment]) => {
    const next = [...adjustments]
    next[index] = { ...next[index], [field]: value }
    setAdjustments(next)
  }

  const addAdjustment = (type: 'addition' | 'deduction') => {
    setAdjustments([
      ...adjustments,
      { type, description: '', plot_name: '', unit: 'หน่วย', quantity: 1, unit_price: 0 },
    ])
  }

  const removeAdjustment = (index: number) => {
    setAdjustments(adjustments.filter((_: Adjustment, i: number) => i !== index))
  }

  const adjustmentPlotOptions = useMemo(() => {
    const names = Array.from(new Set((plots || []).map((p) => p.name).filter(Boolean))) as string[]
    names.sort((a, b) => a.localeCompare(b, 'th', { numeric: true, sensitivity: 'base' }))
    return names
  }, [plots])

  const { totalAddAmount, totalDeductAmount, netAmount } = useMemo(() => {
    const totalAddAmount = adjustments
      .filter((adj) => adj.type === 'addition')
      .reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)
    const totalDeductAmount = adjustments
      .filter((adj) => adj.type === 'deduction')
      .reduce((sum, adj) => sum + adj.quantity * adj.unit_price, 0)
    const netAmount = totalAddAmount - totalDeductAmount
    return { totalAddAmount, totalDeductAmount, netAmount }
  }, [adjustments])

  const uploadFiles = async () => {
    if (newFiles.length === 0) return [] as string[]
    const supabase = createClient()
    const { data: authData } = await supabase.auth.getUser()
    const userId = authData.user?.id || 'anonymous'
    const uploadedUrls: string[] = []

    for (let i = 0; i < newFiles.length; i += 1) {
      const file = newFiles[i]
      const ext = file.name.split('.').pop()
      const path = `billing-attachments/${userId}/${Date.now()}-${i}.${ext}`
      const { error: uploadError } = await supabase.storage.from('assets').upload(path, file)
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)
      const { data: urlData } = supabase.storage.from('assets').getPublicUrl(path)
      uploadedUrls.push(urlData.publicUrl)
    }

    return uploadedUrls
  }

  const handleSubmit = async () => {
    setError(null)
    if (!selectedProject || !selectedContractor || !selectedPlot) {
      setError('กรุณาเลือกโครงการ ผู้รับเหมา และแปลง')
      return
    }
    if (!reason) {
      setError('กรุณาเลือกเหตุผลของงานเพิ่ม')
      return
    }
    if (adjustments.length === 0) {
      setError('กรุณาเพิ่มรายการงานเพิ่มหรืองานหักอย่างน้อย 1 รายการ')
      return
    }

    setIsSubmitting(true)
    try {
      const attachment_urls = [...existingAttachmentUrls, ...(await uploadFiles())]
      const adjustmentsPayload: BillingAdjustmentInput[] = adjustments.map((adj) => ({
        type: adj.type,
        description: adj.description,
        plot_name: adj.plot_name,
        unit: adj.unit,
        quantity: adj.quantity,
        unit_price: adj.unit_price,
      }))

      const payload: BillingPayload = {
        project_id: selectedProject,
        contractor_id: selectedContractor,
        plot_id: selectedPlot,
        billing_date: billingDate,
        type: 'extra_work' as const,
        note,
        reason_for_dc: reason,
        attachment_urls,
        selected_jobs: [],
        adjustments: adjustmentsPayload,
        total_work_amount: 0,
        total_add_amount: totalAddAmount,
        total_deduct_amount: totalDeductAmount,
        net_amount: netAmount,
      }

      const result = editId
        ? await updateBillingRequest(editId, payload)
        : await createBillingRequest(payload)

      if (!result.success) {
        setError(result.error)
        return
      }
      setSuccessNextPath(result.nextPath)
      setDocNo(result.doc_no || '-')
      setShowSuccessModal(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save DC request')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="container mx-auto p-4">
      {showSuccessModal && (
        <Modal
          isOpen={showSuccessModal}
          onClose={() => {
            router.refresh()
            router.push(successNextPath)
          }}
        >
          <div className="p-4 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">ส่งคำขอสำเร็จ</h2>
            <p className="text-gray-600 mb-4">ใบขอเบิกเลขที่ #{docNo} ถูกส่งเพื่อตรวจสอบแล้ว</p>
            <button
              onClick={() => {
                router.refresh()
                router.push(successNextPath)
              }}
              className="w-full bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700"
            >
              ไปที่หน้าถัดไป
            </button>
          </div>
        </Modal>
      )}

      <h1 className="text-2xl font-bold mb-4 text-amber-800">สร้างใบงานเพิ่ม (Extra Work / DC)</h1>
      <Card className="p-4 border-amber-200 bg-amber-50/40">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
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
          <div>
            <label className="block text-sm font-medium text-gray-700">แปลง (บังคับ)</label>
            <select value={selectedPlot} onChange={(e) => setSelectedPlot(e.target.value)} className="mt-1 block w-full p-2 border border-gray-300 rounded-md">
              <option value="">เลือกแปลง</option>
              {plots.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">เหตุผล</label>
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full p-2 border border-gray-300 rounded-md">
              {DC_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">รูปถ่าย</label>
            <label className="mt-1 inline-flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer bg-white">
              <Camera className="h-4 w-4 text-amber-700" />
              <span className="text-sm">เลือกไฟล์</span>
              <input type="file" className="hidden" multiple accept="image/*" onChange={(e) => setNewFiles(Array.from(e.target.files || []))} />
            </label>
            <p className="text-xs text-slate-500 mt-1">ไฟล์ใหม่ {newFiles.length} ไฟล์</p>
          </div>
        </div>

        <div className="mt-6">
          <h2 className="text-xl font-semibold mb-2">รายการเพิ่มเติม (งานเพิ่ม/งานหัก)</h2>

          {/* Column headers */}
          {adjustments.length > 0 && (
            <div className="grid grid-cols-12 gap-2 mb-1 items-center text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <div className="col-span-2">ประเภท</div>
              <div className="col-span-2">แปลง</div>
              <div className="col-span-2">รายละเอียด</div>
              <div className="col-span-1">หน่วย</div>
              <div className="col-span-1 text-right">จำนวน</div>
              <div className="col-span-2 text-right">ราคา/หน่วย</div>
              <div className="col-span-1 text-right">ยอด</div>
              <div className="col-span-1"></div>
            </div>
          )}

          {adjustments.map((adj, index) => {
            const rowTotal = (adj.quantity || 0) * (adj.unit_price || 0)
            const isAdd = adj.type === 'addition'
            return (
              <div key={index} className={`grid grid-cols-12 gap-2 mb-2 items-center rounded-lg p-2 ${isAdd ? 'bg-green-50/60 border border-green-100' : 'bg-red-50/60 border border-red-100'}`}>
                <div className="col-span-2">
                  <select
                    value={adj.type}
                    onChange={(e) => handleAdjustmentChange(index, 'type', e.target.value as Adjustment['type'])}
                    className="w-full p-2 border border-gray-300 rounded-md text-sm"
                  >
                    <option value="addition">งานเพิ่ม</option>
                    <option value="deduction">งานหัก</option>
                  </select>
                </div>
                <div className="col-span-2">
                  {adjustmentPlotOptions.length > 0 ? (
                    <select
                      value={adj.plot_name || ''}
                      onChange={(e) => handleAdjustmentChange(index, 'plot_name', e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="">แปลง (ถ้ามี)</option>
                      {adjustmentPlotOptions.map((plot) => (
                        <option key={plot} value={plot}>{plot}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder="แปลง"
                      value={adj.plot_name || ''}
                      onChange={(e) => handleAdjustmentChange(index, 'plot_name', e.target.value)}
                      className="w-full p-2 border border-gray-300 rounded-md text-sm"
                    />
                  )}
                </div>
                <div className="col-span-2">
                  <input
                    type="text"
                    placeholder="รายละเอียดงาน"
                    value={adj.description}
                    onChange={(e) => handleAdjustmentChange(index, 'description', e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div className="col-span-1">
                  <input
                    type="text"
                    placeholder="หน่วย"
                    value={adj.unit}
                    onChange={(e) => handleAdjustmentChange(index, 'unit', e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div className="col-span-1">
                  <input
                    type="number"
                    placeholder="จำนวน"
                    value={adj.quantity}
                    onChange={(e) => handleAdjustmentChange(index, 'quantity', parseFloat(e.target.value))}
                    className="w-full p-2 border border-gray-300 rounded-md text-sm text-right"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    placeholder="ราคาต่อหน่วย"
                    value={adj.unit_price}
                    onChange={(e) => handleAdjustmentChange(index, 'unit_price', parseFloat(e.target.value))}
                    className="w-full p-2 border border-gray-300 rounded-md text-sm text-right"
                  />
                </div>
                <div className={`col-span-1 text-right font-semibold text-sm ${isAdd ? 'text-green-700' : 'text-red-600'}`}>
                  {isAdd ? '+' : '-'}{formatCurrency(rowTotal)}
                </div>
                <div className="col-span-1">
                  <button type="button" onClick={() => removeAdjustment(index)} className="p-2 text-red-500 hover:text-red-700">
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )
          })}

          {/* Running total bar */}
          {adjustments.length > 0 && (
            <div className="mt-3 flex items-center justify-end gap-6 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm">
              <span className="text-slate-500">งานเพิ่มรวม: <span className="font-bold text-green-700">+{formatCurrency(totalAddAmount)}</span></span>
              <span className="text-slate-500">งานหักรวม: <span className="font-bold text-red-600">-{formatCurrency(totalDeductAmount)}</span></span>
              <span className="font-bold text-amber-800">ยอดสุทธิ: <span className={netAmount >= 0 ? 'text-green-700' : 'text-red-600'}>{formatCurrency(netAmount)}</span></span>
            </div>
          )}

          <button
            type="button"
            onClick={() => addAdjustment('addition')}
            className="flex items-center gap-1 text-sm text-green-600 hover:text-green-800 mt-3"
          >
            <Plus className="h-4 w-4" />
            เพิ่มรายการงานเพิ่ม
          </button>
          <button
            type="button"
            onClick={() => addAdjustment('deduction')}
            className="flex items-center gap-1 text-sm text-red-600 hover:text-red-800 mt-1"
          >
            <Plus className="h-4 w-4" />
            เพิ่มรายการงานหัก
          </button>
        </div>

        <div className="mt-6 bg-white p-4 rounded-lg border border-amber-200">
          <h2 className="text-xl font-semibold mb-4">สรุปยอด</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700">หมายเหตุ (ถึง PM)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
                placeholder="ใส่ข้อความเพิ่มเติมถึงผู้ตรวจสอบ..."
              />
            </div>
            <div className="space-y-1">
              {/* Summary breakdown table */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/40 overflow-hidden">
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="border-b border-amber-100 bg-green-50/50">
                      <td className="px-4 py-2 text-slate-600">+ งานเพิ่ม ({adjustments.filter(a => a.type === 'addition').length} รายการ)</td>
                      <td className="px-4 py-2 text-right font-semibold text-green-700">+{formatCurrency(totalAddAmount)}</td>
                    </tr>
                    <tr className="border-b border-amber-100 bg-red-50/50">
                      <td className="px-4 py-2 text-slate-600">− งานหัก ({adjustments.filter(a => a.type === 'deduction').length} รายการ)</td>
                      <td className="px-4 py-2 text-right font-semibold text-red-600">-{formatCurrency(totalDeductAmount)}</td>
                    </tr>
                    <tr className="bg-amber-100">
                      <td className="px-4 py-3 text-base font-bold text-amber-900">ยอดสุทธิ</td>
                      <td className="px-4 py-3 text-right text-2xl font-bold text-amber-800">{formatCurrency(netAmount)} บาท</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="mt-6 flex justify-end">
            <button onClick={handleSubmit} disabled={isSubmitting} className="px-6 py-3 bg-amber-600 text-white font-bold rounded-md hover:bg-amber-700 disabled:bg-gray-400">
              {isSubmitting ? 'กำลังส่ง...' : 'ส่งคำขอเพื่อพิจารณา'}
            </button>
          </div>
          {error && <p className="mt-2 text-red-500">{error}</p>}
        </div>
      </Card>
    </div>
  )
}
