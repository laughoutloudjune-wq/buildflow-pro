'use client'

import { useState, useEffect, useTransition } from 'react'
import { Plus, Trash2, Loader2, Home, Ruler, Building, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import { getHouseModels, createHouseModel, deleteHouseModel } from '@/actions/boq-actions'
import { getProjects } from '@/actions/project-actions'

export default function HouseModelsPage() {
  const [models, setModels] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true) // ✅ Loading State
  
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setIsLoading(true)
      const [m, p] = await Promise.all([getHouseModels(), getProjects()])
      if (m) setModels(m)
      if (p) setProjects(p)
    } catch (error) {
      console.error("Error loading models:", error)
    } finally {
      setIsLoading(false) // ✅ หยุดหมุนแน่นอน
    }
  }

  const handleSubmit = async (formData: FormData) => {
    setIsModalOpen(false)
    startTransition(async () => {
      await createHouseModel(formData)
      await loadData()
    })
  }

  const handleDelete = async (id: string) => {
    if(!confirm('ยืนยันลบแบบบ้านนี้?')) return
    startTransition(async () => {
      await deleteHouseModel(id)
      await loadData()
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดข้อมูลแบบบ้าน...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">แบบบ้าน & BOQ</h1>
          <p className="text-sm text-slate-500">จัดการแบบบ้านและราคากลางก่อสร้าง</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition shadow-sm"
        >
          <Plus className="h-4 w-4" />
          สร้างแบบบ้านใหม่
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {models.map((model) => (
          <Link key={model.id} href={`/dashboard/boq/${model.id}`}>
            <Card className="group relative overflow-hidden transition-all hover:shadow-md hover:border-indigo-300 cursor-pointer h-full">
              <div className="p-5 space-y-4">
                <div className="flex justify-between items-start">
                  <div className="h-10 w-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <Home className="h-6 w-6" />
                  </div>
                  <button 
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleDelete(model.id)
                    }}
                    disabled={isPending}
                    className="text-slate-300 hover:text-red-500 p-2 hover:bg-red-50 rounded-full transition z-10"
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
                
                <div>
                  <h3 className="text-lg font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">
                    {model.name}
                  </h3>
                  <p className="text-sm text-slate-500">รหัสแบบ: {model.code || '-'}</p>
                </div>

                <div className="pt-4 border-t border-slate-50 flex items-center gap-4 text-sm text-slate-500">
                  <div className="flex items-center gap-1">
                    <Ruler className="h-4 w-4" />
                    {model.area ? `${model.area} ตร.ม.` : '-'}
                  </div>
                  <div className="flex items-center gap-1">
                    <Building className="h-4 w-4" />
                    {model.projects?.name || 'ไม่ระบุโครงการ'}
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}

        {models.length === 0 && (
          <div className="col-span-full py-16 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 text-slate-400">
            <Home className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="mb-4">ยังไม่มีแบบบ้าน</p>
             <button onClick={loadData} className="text-indigo-600 hover:underline text-sm inline-flex items-center gap-1">
              <RefreshCw className="h-3 w-3"/> ลองโหลดใหม่
            </button>
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="เพิ่มแบบบ้านใหม่"
      >
        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อแบบบ้าน</label>
            <input name="name" required className="w-full" placeholder="เช่น Type A (2 ห้องนอน)" />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">รหัสแบบ</label>
              <input name="code" className="w-full" placeholder="H-001" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">พื้นที่ใช้สอย (ตร.ม.)</label>
              <input name="area" type="number" step="0.01" className="w-full" placeholder="120" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ใช้สำหรับโครงการ (Optional)</label>
            <select name="project_id" className="w-full">
              <option value="">-- ใช้ได้ทุกโครงการ --</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 rounded-lg border hover:bg-slate-50 text-slate-600">ยกเลิก</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">บันทึก</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}