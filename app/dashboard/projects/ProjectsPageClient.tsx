'use client'

import { useState, useTransition } from 'react'
import { Plus, MapPin, Trash2, Loader2, Building2 } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge, statusTone } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { createProject, deleteProject } from '@/actions/project-actions'

type Project = {
  id: string
  name: string
  location: string | null
  status: string
}

export default function ProjectsPageClient({ projects }: { projects: Project[] }) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })

  const handleSubmit = async (formData: FormData) => {
    setIsModalOpen(false)
    startTransition(async () => {
      await createProject(formData)
    })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('ยืนยันลบโครงการนี้?')) return
    startTransition(async () => {
      await deleteProject(id)
    })
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
