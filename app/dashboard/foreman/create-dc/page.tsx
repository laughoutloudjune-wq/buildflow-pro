'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/client'
import { getBillingOptions, createBillingRequest } from '@/actions/billing-actions'
import { getPlotsByProjectId } from '@/actions/plot-actions'
import { Plus, Trash2, Camera, CheckCircle } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { formatCurrency } from '@/lib/currency'

type Project = { id: string; name: string }
type Contractor = { id: string; name: string }
type Plot = { id: string; name: string }

type DCItem = {
  description: string
  unit: string
  quantity: number
  unit_price: number
}

const DC_REASONS = ['Owner Request', 'Site Condition', 'Design Error', 'Scope Change', 'Other']

export default function CreateExtraWorkPage() {
  const router = useRouter()

  const [projects, setProjects] = useState<Project[]>([])
  const [contractors, setContractors] = useState<Contractor[]>([])
  const [plots, setPlots] = useState<Plot[]>([])

  const [selectedProject, setSelectedProject] = useState('')
  const [selectedContractor, setSelectedContractor] = useState('')
  const [selectedPlot, setSelectedPlot] = useState('')

  const [reason, setReason] = useState(DC_REASONS[0])
  const [items, setItems] = useState<DCItem[]>([])
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [billingDate] = useState(new Date().toISOString())

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [docNo, setDocNo] = useState<string | number>('')

  useEffect(() => {
    async function fetchOptions() {
      const { projects, contractors } = await getBillingOptions()
      setProjects(projects || [])
      setContractors(contractors || [])
    }
    fetchOptions()
  }, [])

  useEffect(() => {
    if (!selectedProject) {
      setPlots([])
      setSelectedPlot('')
      return
    }
    getPlotsByProjectId(selectedProject).then((data) => setPlots(data || []))
  }, [selectedProject])

  const addItem = () => setItems([...items, { description: '', unit: 'หน่วย', quantity: 1, unit_price: 0 }])
  const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index))
  const updateItem = (index: number, field: keyof DCItem, value: any) => {
    const next = [...items]
    ;(next[index] as any)[field] = value
    setItems(next)
  }

  const totalAddAmount = useMemo(() => {
    return items.reduce((sum, item) => sum + (item.quantity || 0) * (item.unit_price || 0), 0)
  }, [items])

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
    if (items.length === 0) {
      setError('กรุณาเพิ่มรายการงานอย่างน้อย 1 รายการ')
      return
    }

    setIsSubmitting(true)
    try {
      const attachment_urls = await uploadFiles()
      const adjustments = items.map((item) => ({
        type: 'addition',
        description: item.description,
        unit: item.unit,
        quantity: item.quantity,
        unit_price: item.unit_price,
      }))

      const result = await createBillingRequest({
        project_id: selectedProject,
        contractor_id: selectedContractor,
        plot_id: selectedPlot,
        billing_date: billingDate,
        type: 'extra_work',
        reason_for_dc: reason,
        attachment_urls,
        selected_jobs: [],
        adjustments,
        total_work_amount: 0,
        total_add_amount: totalAddAmount,
        total_deduct_amount: 0,
      })

      setDocNo(result?.doc_no || '-')
      setShowSuccessModal(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="container mx-auto p-4">
      {showSuccessModal && (
        <Modal isOpen={showSuccessModal} onClose={() => router.push('/dashboard/foreman/history')}>
          <div className="p-4 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">ส่งคำขอสำเร็จ</h2>
            <p className="text-gray-600 mb-4">ใบขอเบิกเลขที่ #{docNo} ถูกส่งเพื่อตรวจสอบแล้ว</p>
            <button onClick={() => router.push('/dashboard/foreman/history')} className="w-full bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700">
              ไปที่หน้าประวัติคำขอ
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
          <h2 className="text-xl font-semibold mb-2">รายการงานเพิ่ม</h2>
          {items.map((item, index) => (
            <div key={index} className="grid grid-cols-12 gap-2 mb-2 items-center">
              <div className="col-span-5"><input type="text" placeholder="รายละเอียด" value={item.description} onChange={(e) => updateItem(index, 'description', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" /></div>
              <div className="col-span-2"><input type="number" placeholder="จำนวน" value={item.quantity} onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value))} className="w-full p-2 border border-gray-300 rounded-md" /></div>
              <div className="col-span-2"><input type="text" placeholder="หน่วย" value={item.unit} onChange={(e) => updateItem(index, 'unit', e.target.value)} className="w-full p-2 border border-gray-300 rounded-md" /></div>
              <div className="col-span-2"><input type="number" placeholder="ราคาประมาณ" value={item.unit_price} onChange={(e) => updateItem(index, 'unit_price', parseFloat(e.target.value))} className="w-full p-2 border border-gray-300 rounded-md" /></div>
              <div className="col-span-1"><button onClick={() => removeItem(index)} className="p-2 text-red-500 hover:text-red-700"><Trash2 className="h-5 w-5"/></button></div>
            </div>
          ))}
          <button onClick={addItem} className="flex items-center gap-1 text-sm text-amber-700 hover:text-amber-900 mt-2"><Plus className="h-4 w-4"/>เพิ่มรายการ</button>
        </div>

        <div className="mt-6 bg-white p-4 rounded-lg border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500">ยอดรวมงานเพิ่ม</p>
              <p className="text-2xl font-bold text-amber-700">{formatCurrency(totalAddAmount)} บาท</p>
            </div>
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
