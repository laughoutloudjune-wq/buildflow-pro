'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Loader2, Home, Ruler, Building, RefreshCw, Pencil } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { PageContainer } from '@/components/ui/PageContainer'
import { PageToolbar } from '@/components/ui/PageToolbar'
import { EmptyState } from '@/components/ui/EmptyState'
import { useDepartment } from '@/components/layout/DepartmentContext'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import { createHouseModel, deleteHouseModel, updateHouseModel } from '@/actions/boq-actions'

type HouseModel = {
  id: string;
  name: string;
  code: string;
  area: number;
  project_id: string | null;
  projects: {
    name: string;
  } | null;
};
type Project = {
  id: string;
  name: string;
  location?: string | null;
};

export default function HouseModelsPageClient({ models, projects }: { models: HouseModel[]; projects: Project[] }) {
  const router = useRouter()
  const { theme } = useDepartment()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<HouseModel | null>(null)
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<HouseModel | null>(null)
  const toast = useToast()
  const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })

  const openModal = (model: HouseModel | null = null) => {
    setEditingModel(model)
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setEditingModel(null)
    setIsModalOpen(false)
  }

  const handleSubmit = async (formData: FormData) => {
    closeModal()
    startTransition(async () => {
      if (editingModel) {
        await updateHouseModel(editingModel.id, formData)
      } else {
        await createHouseModel(formData)
      }
      router.refresh()
    })
  }

  const handleConfirmDelete = () => {
    if (!deleteTarget) return
    const id = deleteTarget.id
    startTransition(async () => {
      try {
        await deleteHouseModel(id)
        setDeleteTarget(null)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'ลบไม่สำเร็จ')
      }
    })
  }

  const projectMetaById = new Map(projects.map((p: any) => [p.id, p]))
  const searchedModels = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return models
    return models.filter((m) => `${m.name} ${m.code} ${m.projects?.name || ''}`.toLowerCase().includes(q))
  }, [models, search])
  const groupedModels = searchedModels
    .slice()
    .sort((a, b) => {
      const pa = a.project_id ? projectMetaById.get(a.project_id) : null
      const pb = b.project_id ? projectMetaById.get(b.project_id) : null
      const locA = (pa?.location || 'ZZZ ไม่ระบุโครงการ').toString()
      const locB = (pb?.location || 'ZZZ ไม่ระบุโครงการ').toString()
      const locationCompare = collator.compare(locA, locB)
      if (locationCompare !== 0) return locationCompare
      const projectCompare = collator.compare(pa?.name || 'ไม่ระบุโครงการ', pb?.name || 'ไม่ระบุโครงการ')
      if (projectCompare !== 0) return projectCompare
      return collator.compare(a.name || a.code || '', b.name || b.code || '')
    })
    .reduce((acc, model) => {
      const project = model.project_id ? projectMetaById.get(model.project_id) : null
      const key = project
        ? `${project.location || 'ไม่ระบุทำเล'}|||${project.name}`
        : 'ไม่ระบุโครงการ|||แบบบ้านกลาง (ใช้ได้ทุกโครงการ)'
      if (!acc.has(key)) acc.set(key, [])
      acc.get(key)!.push(model)
      return acc
    }, new Map<string, HouseModel[]>())

  return (
    <PageContainer width="wide">
      <PageHeader
        title="แบบบ้าน & BOQ"
        subtitle="จัดการแบบบ้านและราคากลางก่อสร้าง"
        actions={
          <Button onClick={() => openModal()}>
            <Plus className="h-4 w-4" />
            สร้างแบบบ้านใหม่
          </Button>
        }
      />

      <PageToolbar
        search={{ value: search, onChange: setSearch, placeholder: 'ค้นหาชื่อแบบบ้าน / รหัสแบบ / โครงการ' }}
        resultCount={searchedModels.length}
        activeFilters={search.trim() ? [{ label: `ค้นหา "${search.trim()}"`, onRemove: () => setSearch('') }] : []}
        onReset={() => setSearch('')}
      />

      {models.length > 0 && searchedModels.length === 0 && (
        <Card>
          <EmptyState variant="no-results" title="ไม่พบแบบบ้านที่ค้นหา" description="ลองเปลี่ยนคำค้นหา" />
        </Card>
      )}

      <div className="space-y-6">
        {Array.from(groupedModels.entries()).map(([groupKey, groupModels]) => {
          const [locationLabel, projectLabel] = groupKey.split('|||')
          return (
            <div key={groupKey} className="space-y-3">
              <div className="px-1">
                <div className="text-xs font-semibold text-slate-500">{locationLabel}</div>
                <div className="text-sm font-bold text-slate-800">{projectLabel}</div>
              </div>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {groupModels.map((model) => (
          <Card key={model.id} className="group relative overflow-hidden transition-[color,background-color,border-color,box-shadow,transform] hover:shadow-md hover:border-slate-300 cursor-pointer h-full flex flex-col">
            <Link href={`/dashboard/boq/${model.id}`} className="flex-grow">
              <div className="p-5 space-y-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${theme.soft}`}>
                    <Home className="h-6 w-6" />
                  </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800 group-hover:text-slate-950 transition-colors">
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
            </Link>
             {/* Visible on hover, on keyboard focus, and always on touch screens. */}
             <div className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-white/90 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    openModal(model)
                  }}
                  aria-label={`แก้ไขแบบบ้าน ${model.name}`}
                  title="แก้ไข"
                  className="z-10 rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setDeleteTarget(model)
                  }}
                  disabled={isPending}
                  aria-label={`ลบแบบบ้าน ${model.name}`}
                  title="ลบ"
                  className="z-10 rounded-full p-2 text-slate-500 transition hover:bg-red-50 hover:text-red-600"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
          </Card>
                ))}
              </div>
            </div>
          )
        })}

        {models.length === 0 && (
          <Card className="col-span-full">
            <EmptyState
              icon={Home}
              title="ยังไม่มีแบบบ้าน"
              description='กด "สร้างแบบบ้านใหม่" เพื่อเริ่มต้น หรือโหลดข้อมูลใหม่'
              action={
                <Button type="button" variant="secondary" size="sm" onClick={() => router.refresh()}>
                  <RefreshCw className="h-3.5 w-3.5" /> ลองโหลดใหม่
                </Button>
              }
            />
          </Card>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingModel ? 'แก้ไขแบบบ้าน' : 'เพิ่มแบบบ้านใหม่'}
      >
        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อแบบบ้าน</label>
            <input name="name" required className="w-full" placeholder="เช่น Type A (2 ห้องนอน)" defaultValue={editingModel?.name} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">รหัสแบบ</label>
              <input name="code" className="w-full" placeholder="H-001" defaultValue={editingModel?.code} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">พื้นที่ใช้สอย (ตร.ม.)</label>
              <input name="area" type="number" step="0.01" className="w-full" placeholder="120" defaultValue={editingModel?.area} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ใช้สำหรับโครงการ (Optional)</label>
            <select name="project_id" className="w-full" defaultValue={editingModel?.project_id || ''}>
              <option value="">-- ใช้ได้ทุกโครงการ --</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="secondary" onClick={closeModal}>ยกเลิก</Button>
            <Button type="submit" disabled={isPending}>
               {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        title="ลบแบบบ้าน"
        message={deleteTarget ? `ยืนยันลบแบบบ้าน "${deleteTarget.name}"?` : ''}
        confirmLabel={isPending ? 'กำลังลบ...' : 'ลบ'}
        cancelLabel="ยกเลิก"
        tone="danger"
        busy={isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </PageContainer>
  )
}
