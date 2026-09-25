'use client'

import { useMemo, useState, useTransition } from 'react'
import { Plus, MapPin, Trash2, Loader2, Building2, Search } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { createProject, deleteProject, setProjectStatus } from '@/actions/project-actions'

type Project = {
  id: string
  name: string
  location: string | null
  status: string
}

function StatusToggle({ projectId, isActive, onToggled }: { projectId: string; isActive: boolean; onToggled: (next: boolean) => void }) {
  const [pending, setPending] = useState(false)

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (pending) return
    const next = !isActive
    setPending(true)
    onToggled(next) // optimistic
    try {
      await setProjectStatus(projectId, next ? 'active' : 'completed')
    } catch {
      onToggled(!next) // revert on failure
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={isActive ? 'กำลังดำเนินการ - คลิกเพื่อปิดโครงการ' : 'ปิดโครงการแล้ว - คลิกเพื่อเปิดดำเนินการต่อ'}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        isActive ? 'bg-emerald-500' : 'bg-slate-300'
      } ${pending ? 'opacity-60' : ''}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isActive ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function ProjectsPageClient({ projects: initialProjects }: { projects: Project[] }) {
  const [projects, setProjects] = useState<Project[]>(initialProjects)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })

  const handleSubmit = async (formData: FormData) => {
    setIsModalOpen(false)
    startTransition(async () => {
      await createProject(formData)
    })
  }

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    const id = deleteTarget.id
    startTransition(async () => {
      await deleteProject(id)
      setDeleteTarget(null)
    })
  }

  const handleStatusToggled = (id: string, active: boolean) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, status: active ? 'active' : 'completed' } : p)))
  }

  const sortByLocationThenName = (list: Project[]) =>
    list.slice().sort((a, b) => {
      const byLocation = collator.compare(a.location || '', b.location || '')
      if (byLocation !== 0) return byLocation
      return collator.compare(a.name || '', b.name || '')
    })

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => `${p.name} ${p.location || ''}`.toLowerCase().includes(q))
  }, [projects, search])

  // Only 'completed' counts as closed - a project on 'hold' (a valid status
  // in the DB check constraint, just with no toggle for it here) still
  // shows as ongoing, since it's paused, not done.
  const ongoing = sortByLocationThenName(searched.filter((p) => p.status !== 'completed'))
  const closed = sortByLocationThenName(searched.filter((p) => p.status === 'completed'))

  function renderCard(project: Project) {
    const isActive = project.status !== 'completed'
    return (
      <Link key={project.id} href={`/dashboard/projects/${project.id}`}>
        <Card className="group relative overflow-hidden transition-all hover:shadow-md hover:border-indigo-200 cursor-pointer h-full">
          <div className="p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
                <Building2 className="h-6 w-6" />
              </div>
              <StatusToggle projectId={project.id} isActive={isActive} onToggled={(next) => handleStatusToggled(project.id, next)} />
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
                    setDeleteTarget(project)
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

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 py-16 text-center">
          <div className="mb-4 rounded-full bg-white p-4 shadow-sm">
            <Building2 className="h-8 w-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-medium text-slate-900">ยังไม่มีโครงการ</h3>
          <p className="mt-1 text-sm text-slate-500 mb-4">เริ่มต้นด้วยการสร้างโครงการแรกของคุณ</p>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9"
              placeholder="ค้นหาชื่อโครงการ / ทำเล"
            />
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              กำลังดำเนินการ ({ongoing.length})
            </h2>
            {ongoing.length === 0 ? (
              <p className="text-sm text-slate-400">{search ? 'ไม่พบโครงการที่ค้นหา' : 'ไม่มีโครงการที่กำลังดำเนินการ'}</p>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{ongoing.map(renderCard)}</div>
            )}
          </div>

          {closed.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                ปิดโครงการแล้ว ({closed.length})
              </h2>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">{closed.map(renderCard)}</div>
            </div>
          )}
        </div>
      )}

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

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="ลบโครงการ"
        message={deleteTarget ? `ยืนยันลบโครงการ "${deleteTarget.name}"?` : ''}
        confirmLabel={isPending ? 'กำลังลบ...' : 'ลบ'}
        cancelLabel="ยกเลิก"
        tone="danger"
        busy={isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  )
}
