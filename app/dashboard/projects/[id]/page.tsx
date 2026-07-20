'use client'

import { useState, useEffect, useTransition } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Plus, Trash2, ArrowLeft, Loader2, MapPin, AlertCircle, Pencil, Users } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import PlotGroupManager from '@/components/plots/PlotGroupManager'
import { getProjectById, updateProject } from '@/actions/project-actions'
import { getPlotsByProjectId, createPlot, deletePlot } from '@/actions/plot-actions'
import { getHouseModels } from '@/actions/boq-actions'
import { getPlotGroups } from '@/actions/material-actions'
import type { PlotGroup } from '@/lib/types/materials'

export default function ProjectDetailPage() {
  const params = useParams()
  const projectId = params.id as string
  const router = useRouter()

  // แยก State การโหลด (loading) ออกจาก ข้อมูล (project)
  const [isLoading, setIsLoading] = useState(true)
  const [project, setProject] = useState<any>(null)
  const [plots, setPlots] = useState<any[]>([])
  const [houseModels, setHouseModels] = useState<any[]>([])
  const [actionError, setActionError] = useState<string | null>(null)
  
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false)
  const [plotGroups, setPlotGroups] = useState<PlotGroup[]>([])

  const [selectedHouseModelId, setSelectedHouseModelId] = useState('')
  
  const [isPending, startTransition] = useTransition()
  const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })

  const getHouseModelLabel = (model: any) => {
    const projectName = model?.projects?.name
    const projectLocation = model?.projects?.location
    const scopeLabel = projectName
      ? [projectLocation, projectName].filter(Boolean).join(' - ')
      : 'ทุกโครงการ'
    const codeLabel = model?.code ? ` (${model.code})` : ''

    return `${model?.name || 'ไม่ระบุแบบบ้าน'}${codeLabel} - ${scopeLabel}`
  }
  
  useEffect(() => {
  
      if (projectId) loadData()
  
    }, [projectId])
  
  
  
    const loadData = async () => {
  
      try {
  
        setIsLoading(true) // เริ่มโหลด

        const [p, pl, hm, groups] = await Promise.all([

          getProjectById(projectId),

          getPlotsByProjectId(projectId),

          getHouseModels(),

          getPlotGroups(projectId).catch(() => [] as PlotGroup[]),

        ])
  
  
  
        if (!p) {
  
          console.error("Project not found or access denied")
  
        }
  
  
  
        setProject(p)

        setPlots(pl || [])

        setPlotGroups(groups)
  
        
  
        const validModels = (hm?.filter((m: any) => !m.project_id || m.project_id === projectId) || [])
          .sort((a: any, b: any) => collator.compare(a?.name || a?.code || '', b?.name || b?.code || ''))

        setHouseModels(validModels)
  
  
  
      } catch (error) {
  
        console.error("Error loading data:", error)
  
      } finally {

        setIsLoading(false) // โหลดเสร็จแล้ว (ไม่ว่าจะเจอหรือไม่เจอ)

      }

    }

    // Re-fetches just the plot list in place, without toggling `isLoading`
    // (which would blank the whole grid behind a spinner just to add/remove
    // one plot card).
    const refreshPlots = async () => {
      const pl = await getPlotsByProjectId(projectId)
      setPlots(pl || [])
    }

    const refreshGroups = async () => {
      setPlotGroups(await getPlotGroups(projectId).catch(() => [] as PlotGroup[]))
    }

    const groupNameByPlotId = new Map<string, string>()
    for (const group of plotGroups) {
      for (const plotId of group.member_plot_ids) groupNameByPlotId.set(plotId, group.name)
    }

    const handleSubmit = async (formData: FormData) => {

      setIsModalOpen(false)
      setActionError(null)

      startTransition(async () => {

        formData.append('project_id', projectId)

        const res = await createPlot(formData)
        if (!res.success) {
          setActionError(res.error)
          return
        }

        await refreshPlots()

      })

    }

    const handleUpdateProject = async (formData: FormData) => {
      setIsEditModalOpen(false)
      startTransition(async () => {
        await updateProject(projectId, formData)
        // No need to call loadData() because revalidatePath will trigger a refresh
      })
    }
  
  
  
    const handleDelete = async (plotId: string) => {
  
      if (!confirm('ยืนยันลบแปลงนี้? ข้อมูลงานที่มอบหมายจะหายไปด้วย')) return
      setActionError(null)
  
      startTransition(async () => {
  
        const res = await deletePlot(plotId, projectId)
        if (!res.success) {
          setActionError(res.error)
          return
        }

        await refreshPlots()

      })
  
    }
  
  
  
    const sortedPlots = [...plots].sort((a, b) => collator.compare(a?.name || '', b?.name || ''))

    const plotsWithSameModel = selectedHouseModelId 
  
      ? sortedPlots.filter(p => p.house_models?.id === selectedHouseModelId) 
  
      : []
  
  
  
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
        {actionError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {actionError}
          </div>
        ) : null}
  
        <div>
          <button
            onClick={() => router.push('/dashboard/projects')}
            className="mb-2 flex items-center gap-1 text-sm text-slate-500 hover:text-indigo-600 transition"
          >
            <ArrowLeft className="h-4 w-4" /> กลับหน้ารวม
          </button>
          <PageHeader
            title={
              <span className="flex items-center gap-3">
                {project.name}
                <button onClick={() => setIsEditModalOpen(true)} className="text-slate-400 hover:text-indigo-600">
                  <Pencil className="h-4 w-4" />
                </button>
              </span>
            }
            subtitle={
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {project.location || 'ไม่ระบุทำเล'}
              </span>
            }
            actions={
              <>
                <Button variant="secondary" onClick={() => setIsGroupManagerOpen(true)}>
                  <Users className="h-4 w-4" />
                  จัดกลุ่มแปลง
                </Button>
                <Button
                  onClick={() => {
                    setSelectedHouseModelId('')
                    setIsModalOpen(true)
                  }}
                >
                  <Plus className="h-4 w-4" />
                  เพิ่มแปลงที่ดิน
                </Button>
              </>
            }
          />
        </div>
  
  
  
        <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
  
          {sortedPlots.map((plot) => (
  
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
  
                  <div className="w-full pt-3 border-t border-slate-50 flex flex-wrap items-center justify-center gap-1.5">

                      <Badge tone="success">
                          กำลังก่อสร้าง
                      </Badge>

                      {groupNameByPlotId.has(plot.id) && (

                        <span className="inline-flex items-center gap-1 text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">

                          <Users className="h-3 w-3" />

                          {groupNameByPlotId.get(plot.id)}

                        </span>

                      )}

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
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          title="แก้ไขรายละเอียดโครงการ"
        >
          <form action={handleUpdateProject} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อโครงการ</label>
              <input name="name" required className="w-full" defaultValue={project.name} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ทำเล / ที่ตั้ง</label>
              <input name="location" className="w-full" defaultValue={project.location} />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="secondary" onClick={() => setIsEditModalOpen(false)}>ยกเลิก</Button>
              <Button type="submit">บันทึก</Button>
            </div>
          </form>
        </Modal>
  
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
  
              <select 
  
                name="house_model_id" 
  
                required 
  
                className="w-full"
  
                onChange={(e) => setSelectedHouseModelId(e.target.value)}
  
                defaultValue=""
  
              >
  
                <option value="" disabled>-- เลือกแบบบ้าน --</option>
  
                {houseModels.map(m => (
  
                  <option key={m.id} value={m.id}>{getHouseModelLabel(m)}</option>
  
                ))}
  
              </select>
  
            </div>
  
  
  
            {selectedHouseModelId && plotsWithSameModel.length > 0 && (
  
               <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg">
  
                 <label className="mb-1 block text-sm font-medium text-indigo-800">คัดลอกการตั้งค่าจากแปลงอื่น</label>
  
                  <select name="source_plot_id" className="w-full" defaultValue="">
  
                    <option value="">-- ไม่คัดลอก --</option>
  
                    {plotsWithSameModel.map(p => (
  
                      <option key={p.id} value={p.id}>{p.name}</option>
  
                    ))}
  
                  </select>
  
                  <p className="text-xs text-slate-500 mt-1">*ระบบจะคัดลอก 'ผู้รับเหมา' ที่ผูกกับแต่ละรายการงานมาด้วย</p>
  
               </div>
  
            )}
  
  
  
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>ยกเลิก</Button>
              <Button type="submit">บันทึก</Button>
            </div>
  
          </form>

        </Modal>

        <PlotGroupManager
          isOpen={isGroupManagerOpen}
          onClose={() => setIsGroupManagerOpen(false)}
          projectId={projectId}
          plots={sortedPlots.map((plot) => ({ id: plot.id, name: plot.name }))}
          onChanged={refreshGroups}
        />

      </div>

    )

  }
