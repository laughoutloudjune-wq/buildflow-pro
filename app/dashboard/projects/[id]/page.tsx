'use client'

import { useState, useEffect, useTransition } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Plus, Trash2, ArrowLeft, Loader2, MapPin, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import Modal from '@/components/ui/Modal'
import { getProjectById } from '@/actions/project-actions'
import { getPlotsByProjectId, createPlot, deletePlot } from '@/actions/plot-actions'
import { getHouseModels } from '@/actions/boq-actions'

export default function ProjectDetailPage() {
  const params = useParams()
  const projectId = params.id as string
  const router = useRouter()

  // แยก State การโหลด (loading) ออกจาก ข้อมูล (project)
  const [isLoading, setIsLoading] = useState(true)
  const [project, setProject] = useState<any>(null)
  const [plots, setPlots] = useState<any[]>([])
  const [houseModels, setHouseModels] = useState<any[]>([])
  
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (projectId) loadData()
  }, [projectId])

  const loadData = async () => {
    try {
      setIsLoading(true) // เริ่มโหลด
      
      const [p, pl, hm] = await Promise.all([
        getProjectById(projectId),
        getPlotsByProjectId(projectId),
        getHouseModels()
      ])

      if (!p) {
        console.error("Project not found or access denied")
      }

      setProject(p)
      setPlots(pl || [])
      
      const validModels = hm?.filter((m: any) => !m.project_id || m.project_id === projectId) || []
      setHouseModels(validModels)

    } catch (error) {
      console.error("Error loading data:", error)
    } finally {
      setIsLoading(false) // โหลดเสร็จแล้ว (ไม่ว่าจะเจอหรือไม่เจอ)
    }
  }

  const handleSubmit = async (formData: FormData) => {
    setIsModalOpen(false)
    startTransition(async () => {
      formData.append('project_id', projectId)
      await createPlot(formData)
      await loadData()
    })
  }

  const handleDelete = async (plotId: string) => {
    if (!confirm('ยืนยันลบแปลงนี้? ข้อมูลงานที่มอบหมายจะหายไปด้วย')) return
    startTransition(async () => {
      await deletePlot(plotId, projectId)
      await loadData()
    })
  }

  // --- ส่วนแสดงผล (Render) ---

  // 1. ถ้ากำลังโหลด แสดง Loading
  if (isLoading) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-slate-500 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังโหลดข้อมูลโครงการ...</p>
      </div>
    )
  }

  // 2. ถ้าโหลดเสร็จแล้ว แต่ไม่มีข้อมูล (หา ID ไม่เจอ หรือ DB บล็อก)
  if (!project) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-slate-500 gap-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <div className="text-center">
          <h3 className="text-lg font-bold text-slate-800">ไม่พบข้อมูลโครงการ</h3>
          <p className="text-sm">อาจถูกลบไปแล้ว หรือคุณไม่มีสิทธิ์เข้าถึง</p>
        </div>
        <button 
            onClick={() => router.push('/dashboard/projects')}
            className="text-indigo-600 hover:underline"
        >
            กลับไปหน้ารวมโครงการ
        </button>
      </div>
    )
  }

  // 3. ถ้าเจอข้อมูล แสดงหน้าปกติ
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <button 
            onClick={() => router.push('/dashboard/projects')}
            className="mb-2 flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600 transition"
          >
            <ArrowLeft className="h-4 w-4" /> กลับหน้ารวม
          </button>
          <h1 className="text-2xl font-bold text-slate-800">{project.name}</h1>
          <div className="flex items-center gap-2 text-sm text-slate-500 mt-1">
            <MapPin className="h-4 w-4" />
            {project.location || 'ไม่ระบุทำเล'}
          </div>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 shadow-sm"
        >
          <Plus className="h-4 w-4" />
          เพิ่มแปลงที่ดิน
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
        {plots.map((plot) => (
          <Link key={plot.id} href={`/dashboard/projects/${projectId}/${plot.id}`}>
             <Card className="group relative overflow-hidden transition-all hover:shadow-md hover:border-indigo-300 cursor-pointer h-full">
              <div className="p-4 flex flex-col items-center text-center space-y-3">
                <div className="h-12 w-12 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-lg">
                  {plot.name.substring(0, 3)}
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-lg">{plot.name}</h3>
                  <p className="text-sm text-slate-500">{plot.house_models?.name || 'ไม่ระบุแบบ'}</p>
                </div>
                <div className="w-full pt-3 border-t border-slate-50">
                    <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">
                        กำลังก่อสร้าง
                    </span>
                </div>
              </div>
              <button 
                onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    handleDelete(plot.id)
                }}
                disabled={isPending}
                className="absolute top-2 right-2 text-slate-300 hover:text-red-500 p-1 hover:bg-red-50 rounded transition z-10"
              >
                 {isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4" />}
              </button>
            </Card>
          </Link>
        ))}

        {plots.length === 0 && (
          <div className="col-span-full py-12 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 text-slate-400">
            ยังไม่มีแปลงที่ดินในโครงการนี้
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="เพิ่มแปลงใหม่"
      >
        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อแปลง / บ้านเลขที่</label>
            <input name="name" required className="w-full" placeholder="เช่น A1, 88/1" />
          </div>
          
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">แบบบ้าน</label>
            <select name="house_model_id" required className="w-full">
              <option value="">-- เลือกแบบบ้าน --</option>
              {houseModels.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.code})</option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">*เมื่อสร้างแปลง ระบบจะดึง BOQ มาสร้างงานให้อัตโนมัติ</p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={() => setIsModalOpen(false)} className="btn-secondary">ยกเลิก</button>
            <button type="submit" className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 shadow transition">บันทึก</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}