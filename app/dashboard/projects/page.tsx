'use client'

import { useState, useEffect, useTransition } from 'react'
import { Plus, MapPin, Trash2, Loader2, Building2, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge, statusTone } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { getProjects, createProject, deleteProject } from '@/actions/project-actions'

type Project = {
  id: string
  name: string
  location: string | null
  status: string
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true) // ✅ เริ่มต้นเป็น true เสมอ
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })
  
  // โหลดข้อมูลเมื่อเข้าหน้าเว็บ
  useEffect(() => {
    loadProjects()
  }, [])

  const loadProjects = async () => {
    try {
      setIsLoading(true)
      console.log("Start fetching projects...") // 🛠 Debug Log 1

      const data = await getProjects()
      
      console.log("Fetched Data:", data) // 🛠 Debug Log 2 (ดูว่าข้อมูลมาไหม)
      
      if (data) setProjects(data)
    } catch (error) {
      console.error("Error loading projects:", error)
      alert("เกิดข้อผิดพลาดในการโหลดข้อมูล (ดู Console)")
    } finally {
      setIsLoading(false) // ✅ บังคับหยุดหมุน ไม่ว่าจะ error หรือไม่
    }
  }

  const handleSubmit = async (formData: FormData) => {
    setIsModalOpen(false)
    startTransition(async () => {
      await createProject(formData)
      await loadProjects()
    })
  }

  const handleDelete = async (id: string) => {
    if(!confirm('ยืนยันลบโครงการนี้?')) return
    startTransition(async () => {
      await deleteProject(id)
      await loadProjects()
    })
  }

  // --- ส่วนแสดงผล ---

  if (isLoading) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        <p>กำลังเชื่อมต่อฐานข้อมูล...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="จัดการโครงการ"
        subtitle="รายชื่อโครงการก่อสร้างทั้งหมด"
        actions={
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus className="h-4 w-4" />
            เพิ่มโครงการ
          </Button>
        }
      />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {projects
          .slice()
          .sort((a, b) => {
            const byLocation = collator.compare(a.location || '', b.location || '')
            if (byLocation !== 0) return byLocation
            return collator.compare(a.name || '', b.name || '')
          })
          .map((project) => (
          <Link key={project.id} href={`/dashboard/projects/${project.id}`}>
            <Card className="group relative overflow-hidden transition-all hover:shadow-md hover:border-indigo-200 cursor-pointer h-full">
              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
                    <Building2 className="h-6 w-6" />
                  </div>
                  <Badge tone={statusTone(project.status)}>
                    {project.status === 'active' ? 'กำลังดำเนินการ' : project.status}
                  </Badge>
                </div>
                
                <h3 className="text-lg font-bold text-slate-800 mb-1 group-hover:text-indigo-600 transition-colors">
                  {project.name}
                </h3>
                
                <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
                  <MapPin className="h-4 w-4" />
                  {project.location || 'ไม่ระบุทำเล'}
                </div>

                <div className="flex items-center justify-end border-t pt-3 mt-2">
                   <button 
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        handleDelete(project.id)
                      }}
                      disabled={isPending}
                      className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition z-10"
                   >
                      {isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4" />}
                   </button>
                </div>
              </div>
            </Card>
          </Link>
        ))}

        {projects.length === 0 && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">
            <div className="mb-4 rounded-full bg-white p-4 shadow-sm">
              <Building2 className="h-8 w-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900">ยังไม่มีโครงการ</h3>
            <p className="mt-1 text-sm text-slate-500 mb-4">เริ่มต้นด้วยการสร้างโครงการแรกของคุณ</p>
            <button 
              onClick={loadProjects} 
              className="text-indigo-600 hover:underline text-sm flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3"/> ลองโหลดใหม่
            </button>
          </div>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="เพิ่มโครงการใหม่"
      >
        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อโครงการ</label>
            <input name="name" required placeholder="เช่น หมู่บ้านจัดสรร A" className="w-full" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ทำเลที่ตั้ง</label>
            <input name="location" placeholder="เช่น อ.เมือง จ.เชียงใหม่" className="w-full" />
          </div>
          <div className="pt-2 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>ยกเลิก</Button>
            <Button type="submit">บันทึก</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
