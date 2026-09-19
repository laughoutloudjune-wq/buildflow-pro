'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, ArrowLeft, Loader2, MapPin, AlertCircle, Pencil, Users, GaugeCircle, LayoutList, Map as MapIcon, Search } from 'lucide-react'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Button, ButtonLink } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import Modal from '@/components/ui/Modal'
import PlotGroupManager from '@/components/plots/PlotGroupManager'
import SitePlanMap, { type SitePlanMarker } from '@/components/plots/SitePlanMap'
import { getProjectById, updateProject } from '@/actions/project-actions'
import { getPlotsByProjectId, createPlot, deletePlot, setPlotSellable } from '@/actions/plot-actions'
import { getHouseModels } from '@/actions/boq-actions'
import { getPlotGroups } from '@/actions/material-actions'
import type { PlotGroup } from '@/lib/types/materials'

type Project = Awaited<ReturnType<typeof getProjectById>>
type Plot = Awaited<ReturnType<typeof getPlotsByProjectId>>[number]
type HouseModelOption = Awaited<ReturnType<typeof getHouseModels>>[number]
type ViewMode = 'map' | 'list'
type SellableFilter = 'all' | 'sellable' | 'not_sellable'

function SellableToggle({
  plotId,
  projectId,
  isSellable,
  onToggled,
}: {
  plotId: string
  projectId: string
  isSellable: boolean
  onToggled: (next: boolean) => void
}) {
  const [pending, setPending] = useState(false)

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (pending) return
    const next = !isSellable
    setPending(true)
    onToggled(next) // optimistic
    const res = await setPlotSellable(plotId, projectId, next)
    setPending(false)
    if (!res.success) onToggled(!next) // revert on failure
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title={isSellable ? 'เปิดขายอยู่ - คลิกเพื่อปิด' : 'ปิดขายอยู่ - คลิกเพื่อเปิด'}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        isSellable ? 'bg-emerald-500' : 'bg-slate-300'
      } ${pending ? 'opacity-60' : ''}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isSellable ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function ProjectDetailPageClient({
  projectId,
  project,
  initialPlots,
  houseModels,
  initialPlotGroups,
}: {
  projectId: string
  project: Project
  initialPlots: Plot[]
  houseModels: HouseModelOption[]
  initialPlotGroups: PlotGroup[]
}) {
  const router = useRouter()
  const [plots, setPlots] = useState<Plot[]>(initialPlots)
  const [plotGroups, setPlotGroups] = useState<PlotGroup[]>(initialPlotGroups)
  const [actionError, setActionError] = useState<string | null>(null)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false)

  const [selectedHouseModelId, setSelectedHouseModelId] = useState('')

  const [viewMode, setViewMode] = useState<ViewMode>('map')
  const [search, setSearch] = useState('')
  const [houseModelFilter, setHouseModelFilter] = useState('')
  const [sellableFilter, setSellableFilter] = useState<SellableFilter>('all')
  const [groupFilter, setGroupFilter] = useState('')

  const [isPending, startTransition] = useTransition()
  const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' })

  const getHouseModelLabel = (model: HouseModelOption) => {
    const projectName = model?.projects?.name
    const projectLocation = model?.projects?.location
    const scopeLabel = projectName
      ? [projectLocation, projectName].filter(Boolean).join(' - ')
      : 'ทุกโครงการ'
    const codeLabel = model?.code ? ` (${model.code})` : ''

    return `${model?.name || 'ไม่ระบุแบบบ้าน'}${codeLabel} - ${scopeLabel}`
  }

  // Re-fetches just the plot list in place, without a full page reload
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
  const groupIdByPlotId = new Map<string, string>()
  for (const group of plotGroups) {
    for (const plotId of group.member_plot_ids) {
      groupNameByPlotId.set(plotId, group.name)
      groupIdByPlotId.set(plotId, group.id)
    }
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
      // No need to call router.refresh() because revalidatePath will trigger one
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

  const handleSellableToggled = (plotId: string, next: boolean) => {
    setPlots((prev) => prev.map((p) => (p.id === plotId ? { ...p, is_sellable: next } : p)))
  }

  const sortedPlots = [...plots].sort((a, b) => collator.compare(a?.name || '', b?.name || ''))

  const plotsWithSameModel = selectedHouseModelId
    ? sortedPlots.filter((p) => p.house_models?.id === selectedHouseModelId)
    : []

  const matchesFilters = (plot: Plot) => {
    if (search.trim() && !plot.name.toLowerCase().includes(search.trim().toLowerCase())) return false
    if (houseModelFilter && plot.house_models?.id !== houseModelFilter) return false
    if (sellableFilter === 'sellable' && plot.is_sellable === false) return false
    if (sellableFilter === 'not_sellable' && plot.is_sellable !== false) return false
    if (groupFilter && groupIdByPlotId.get(plot.id) !== groupFilter) return false
    return true
  }

  const filteredPlots = sortedPlots.filter(matchesFilters)
  const hasActiveFilters = Boolean(search.trim() || houseModelFilter || sellableFilter !== 'all' || groupFilter)

  const markers: SitePlanMarker[] = useMemo(
    () =>
      sortedPlots.map((plot) => ({
        id: plot.id,
        label: plot.name,
        colorClass: plot.is_sellable === false ? 'bg-slate-400' : 'bg-emerald-500',
        meta: plot.house_models?.name || undefined,
        mapX: plot.map_x,
        mapY: plot.map_y,
        dimmed: hasActiveFilters && !matchesFilters(plot),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedPlots, projectId, hasActiveFilters, search, houseModelFilter, sellableFilter, groupFilter]
  )

  // ถ้าโหลดเสร็จแล้ว แต่ไม่มีข้อมูล (หา ID ไม่เจอ หรือ DB บล็อก)
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
              <ButtonLink href={`/dashboard/cost-control?project=${projectId}`} variant="secondary">
                <GaugeCircle className="h-4 w-4" />
                คุม BOQ & ต้นทุน
              </ButtonLink>
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

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs font-medium text-slate-500">ค้นหาแปลง</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ชื่อแปลง..."
              className="w-full pl-8"
            />
          </div>
        </div>
        <div className="min-w-[180px]">
          <label className="mb-1 block text-xs font-medium text-slate-500">แบบบ้าน</label>
          <select value={houseModelFilter} onChange={(e) => setHouseModelFilter(e.target.value)} className="w-full">
            <option value="">ทั้งหมด</option>
            {houseModels.map((m) => (
              <option key={m.id} value={m.id}>{m.name}{m.code ? ` (${m.code})` : ''}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[150px]">
          <label className="mb-1 block text-xs font-medium text-slate-500">สถานะขาย</label>
          <select value={sellableFilter} onChange={(e) => setSellableFilter(e.target.value as SellableFilter)} className="w-full">
            <option value="all">ทั้งหมด</option>
            <option value="sellable">เปิดขาย</option>
            <option value="not_sellable">ไม่ขาย</option>
          </select>
        </div>
        {plotGroups.length > 0 && (
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-slate-500">กลุ่มแปลง</label>
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="w-full">
              <option value="">ทั้งหมด</option>
              {plotGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}
        {hasActiveFilters && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setSearch('')
              setHouseModelFilter('')
              setSellableFilter('all')
              setGroupFilter('')
            }}
          >
            ล้างตัวกรอง
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setViewMode('map')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              viewMode === 'map' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <MapIcon className="h-4 w-4" /> ผังโครงการ
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <LayoutList className="h-4 w-4" /> รายการ
          </button>
        </div>
        {viewMode === 'list' && (
          <span className="w-full text-right text-xs text-slate-400">{filteredPlots.length} / {plots.length} แปลง</span>
        )}
      </Card>

      {viewMode === 'map' ? (
        <SitePlanMap
          key={projectId}
          projectId={projectId}
          sitePlanUrl={project.site_plan_url}
          sitePlanWidth={project.site_plan_width}
          sitePlanHeight={project.site_plan_height}
          canEdit
          markers={markers}
          unplacedEmptyLabel="วางครบทุกแปลงแล้ว"
          plotDetailTabs={['construction', 'materials', 'requests', 'history']}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">แปลง</th>
                  <th className="px-4 py-3 font-semibold">แบบบ้าน</th>
                  <th className="px-4 py-3 font-semibold">เนื้อที่ (ตร.ว.)</th>
                  <th className="px-4 py-3 font-semibold">กลุ่ม</th>
                  <th className="px-4 py-3 font-semibold">เปิดขาย</th>
                  <th className="px-4 py-3 font-semibold w-[50px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredPlots.map((plot) => (
                  <tr key={plot.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/projects/${projectId}/${plot.id}`} className="font-medium text-slate-800 hover:text-indigo-600">
                        {plot.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{plot.house_models?.name || 'ไม่ระบุแบบ'}</td>
                    <td className="px-4 py-3 text-slate-500">{plot.land_area_sqwa ?? '—'}</td>
                    <td className="px-4 py-3">
                      {groupNameByPlotId.has(plot.id) ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-1 text-xs text-indigo-700">
                          <Users className="h-3 w-3" />
                          {groupNameByPlotId.get(plot.id)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <SellableToggle
                        plotId={plot.id}
                        projectId={projectId}
                        isSellable={plot.is_sellable !== false}
                        onToggled={(next) => handleSellableToggled(plot.id, next)}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleDelete(plot.id)}
                        disabled={isPending}
                        className="rounded p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                      >
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredPlots.length === 0 && (
              <div className="py-12 text-center text-slate-400">
                {plots.length === 0 ? 'ยังไม่มีแปลงที่ดินในโครงการนี้' : 'ไม่พบแปลงตามตัวกรองนี้'}
              </div>
            )}
          </div>
        </Card>
      )}

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
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ที่อยู่จัดส่งประจำ</label>
            <textarea
              name="delivery_address"
              className="w-full"
              rows={3}
              defaultValue={project.delivery_address || ''}
              placeholder="เช่น จุดส่งของ ผู้ติดต่อหน้างาน เบอร์โทร เวลาที่สะดวก"
            />
            <p className="mt-1 text-xs text-slate-500">
              ใช้เติมช่อง &ldquo;หมายเหตุการจัดส่ง&rdquo; ให้อัตโนมัติเมื่อสร้างใบสั่งซื้อของโครงการนี้ และยังแก้ไขรายใบได้
            </p>
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
                <p className="text-xs text-slate-500 mt-1">*ระบบจะคัดลอก &apos;ผู้รับเหมา&apos; ที่ผูกกับแต่ละรายการงานมาด้วย</p>
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
