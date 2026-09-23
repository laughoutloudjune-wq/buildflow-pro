'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ClipboardCheck, ClipboardList, Hammer, History, LayoutGrid, Pencil, Tag } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import PlotOverviewTab from '@/components/plots/PlotOverviewTab'
import PlotSalesTab from '@/components/plots/PlotSalesTab'
import PlotConstructionTab from '@/components/plots/PlotConstructionTab'
import PlotMaterialsTab from '@/components/plots/PlotMaterialsTab'
import PlotHistoryTab from '@/components/plots/PlotHistoryTab'
import PlotWorkRequestsTab from '@/components/plots/PlotWorkRequestsTab'
import {
  assignContractor,
  getJobAssignments,
  getPlotById,
  syncPlotJobs,
  updateAgreedPricePerUnit,
  updateJobStatus,
} from '@/actions/job-actions'
import { updatePlot } from '@/actions/plot-actions'
import { getHouseModels } from '@/actions/boq-actions'
import { getContractors } from '@/actions/contractor-actions'
import type { PlotSaleDetail, SaleStatus } from '@/actions/sales-actions'
import type { WorkRequestRow } from '@/actions/sales-work-requests'
import type { SalePaymentRow } from '@/actions/sale-payments-actions'
import type { PlotHistoryRowView, PlotJobRow, PlotMaterialRowView } from '@/lib/types/plotDetail'

type Plot = Awaited<ReturnType<typeof getPlotById>>
type Contractor = Awaited<ReturnType<typeof getContractors>>[number]
type HouseModel = Awaited<ReturnType<typeof getHouseModels>>[number]

export type PlotDetailTab = 'overview' | 'sales' | 'construction' | 'materials' | 'requests' | 'history'
type Tab = PlotDetailTab

function buildPriceDrafts(jobs: PlotJobRow[]): Record<string, string> {
  return jobs.reduce((acc: Record<string, string>, job) => {
    acc[job.id] = job.cost?.agreedPricePerUnit == null ? '' : String(job.cost.agreedPricePerUnit)
    return acc
  }, {})
}

export default function PlotDetailPageClient({
  fetchedAt,
  projectId,
  plotId,
  plot,
  jobs: initialJobs,
  jobsDone,
  contractors,
  houseModels,
  saleDetail,
  saleStatuses,
  history,
  materials,
  workRequests,
  payments,
  canSeeCost,
  canEditConstruction,
  canEditSales,
  onClose,
  onRefresh,
  visibleTabs,
}: {
  /** From getPlotDetailBundle - changes on every real fetch, used to force
   * PlotSalesTab (uncontrolled fields) to remount with fresh data after a
   * save, instead of a manually-timed counter that can fire before the
   * refetch actually resolves. */
  fetchedAt: number
  projectId: string
  plotId: string
  plot: Plot
  jobs: PlotJobRow[]
  jobsDone: number
  contractors: Contractor[]
  houseModels: HouseModel[]
  saleDetail: PlotSaleDetail
  saleStatuses: SaleStatus[]
  history: PlotHistoryRowView[]
  materials: PlotMaterialRowView[]
  workRequests: WorkRequestRow[]
  payments: SalePaymentRow[]
  canSeeCost: boolean
  canEditConstruction: boolean
  canEditSales: boolean
  /** Set when rendered inside PlotDetailModal (the map's quick-view) instead
   * of as its own page - swaps the "back to list" navigation for just
   * closing the modal, so it doesn't push a real page navigation from
   * inside a dialog. */
  onClose?: () => void
  /** How the sales tab (status changes, deal details, payments) gets fresh
   * data after a save. The standalone page has no server-refetch of its own
   * to call, so it falls back to router.refresh(); PlotDetailModal passes
   * its own bundle refetch instead, since router.refresh() only re-runs the
   * page behind the modal, not the modal's independently-fetched data. */
  onRefresh?: () => void
  /** Restricts which tabs show, e.g. the sales map's quick-view has no
   * business showing งานก่อสร้าง/วัสดุ - those are the construction
   * department's own page. Undefined (the standalone page, and the
   * construction map's modal) shows every tab as before. */
  visibleTabs?: PlotDetailTab[]
}) {
  const router = useRouter()
  const refresh = onRefresh ?? (() => router.refresh())
  const [isPending, startTransition] = useTransition()
  const [tab, setTab] = useState<Tab>('overview')

  const [jobs, setJobs] = useState<PlotJobRow[]>(initialJobs)
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>(() => buildPriceDrafts(initialJobs))

  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  const getHouseModelLabel = (model: HouseModel) => {
    const projectName = model?.projects?.name
    const projectLocation = model?.projects?.location
    const scopeLabel = projectName
      ? [projectLocation, projectName].filter(Boolean).join(' - ')
      : 'ทุกโครงการ'
    const codeLabel = model?.code ? ` (${model.code})` : ''
    return `${model?.name || 'ไม่ระบุแบบบ้าน'}${codeLabel} - ${scopeLabel}`
  }

  // Re-fetches just the job list, mapping the raw shape back onto
  // PlotJobRow's client-side view - only reachable when canEditConstruction
  // is true (sync/assign/status controls are hidden otherwise), so cost is
  // always populated here; the server-side strip only matters on first load.
  const refreshJobs = async () => {
    const jData = await getJobAssignments(plotId)
    const mapped: PlotJobRow[] = (jData || []).map((job) => {
      const agreedPrice = job.agreed_price_per_unit as number | null
      const boqPrice = (job.boq_master?.price_per_unit as number | null) || 0
      const quantity = (job.boq_master?.quantity as number | null) || 0
      const effectivePrice = (agreedPrice ?? boqPrice) || 0
      const totalBoq = quantity * effectivePrice
      const paid = ((job.payments || []) as Array<{ amount: number | null }>).reduce((s, p) => s + (p.amount || 0), 0)
      return {
        id: job.id,
        status: job.status,
        itemName: job.boq_master?.item_name || '',
        unit: job.boq_master?.unit || '',
        quantity,
        contractorId: job.contractor_id,
        cost: { contractorName: job.contractors?.name || null, agreedPricePerUnit: agreedPrice, boqPricePerUnit: boqPrice, effectivePrice, totalBoq, paid },
      }
    })
    setJobs(mapped)
    setPriceDrafts((prev) => {
      const next = { ...prev }
      for (const job of mapped) {
        if (!(job.id in next)) next[job.id] = job.cost?.agreedPricePerUnit == null ? '' : String(job.cost.agreedPricePerUnit)
      }
      return next
    })
  }

  const handleAssign = (jobId: string, contractorId: string) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, contractorId: contractorId || null } : j)))
    startTransition(async () => {
      await assignContractor(jobId, contractorId, plotId, projectId)
    })
  }

  const handleStatusChange = (jobId: string, newStatus: string) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status: newStatus } : j)))
    startTransition(async () => {
      await updateJobStatus(jobId, newStatus, plotId, projectId)
    })
  }

  const handleSync = () => {
    if (!plot) return
    if (!confirm('ต้องการดึงรายการ BOQ ล่าสุดมาเพิ่มใช่ไหม?')) return
    startTransition(async () => {
      await syncPlotJobs(plotId, plot.house_model_id, projectId)
      await refreshJobs()
    })
  }

  const handlePriceDraftChange = (jobId: string, value: string) => {
    setPriceDrafts((prev) => ({ ...prev, [jobId]: value }))
  }

  const handleSaveVariablePrice = (job: PlotJobRow) => {
    const raw = (priceDrafts[job.id] ?? '').trim()
    const next = raw === '' ? null : Number(raw)
    if (next != null && (!Number.isFinite(next) || next < 0)) {
      alert('กรุณาใส่ราคาต่อหน่วยที่ถูกต้อง')
      return
    }
    setJobs((prev) => prev.map((j) => (j.id === job.id && j.cost ? { ...j, cost: { ...j.cost, agreedPricePerUnit: next } } : j)))
    startTransition(async () => {
      await updateAgreedPricePerUnit(job.id, next, plotId, projectId)
    })
  }

  const handleResetVariablePrice = (job: PlotJobRow) => {
    setPriceDrafts((prev) => ({ ...prev, [job.id]: '' }))
    setJobs((prev) => prev.map((j) => (j.id === job.id && j.cost ? { ...j, cost: { ...j.cost, agreedPricePerUnit: null } } : j)))
    startTransition(async () => {
      await updateAgreedPricePerUnit(job.id, null, plotId, projectId)
    })
  }

  const handleUpdatePlot = async (formData: FormData) => {
    setIsEditModalOpen(false)
    startTransition(async () => {
      await updatePlot(plotId, projectId, formData)
    })
  }

  if (!plot) return <div className="p-8 text-center text-red-500">ไม่พบข้อมูลแปลง</div>

  const ALL_TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
    { key: 'overview', label: 'ภาพรวม', icon: LayoutGrid },
    { key: 'sales', label: 'การขาย', icon: Tag },
    { key: 'construction', label: 'งานก่อสร้าง', icon: Hammer },
    { key: 'materials', label: 'วัสดุ', icon: ClipboardList },
    { key: 'requests', label: 'คำขอจากฝ่ายขาย', icon: ClipboardCheck },
    { key: 'history', label: 'ประวัติ', icon: History },
  ]
  const TABS = visibleTabs ? ALL_TABS.filter((t) => visibleTabs.includes(t.key)) : ALL_TABS
  // The sales map's quick-view has no งานก่อสร้าง tab at all (visibleTabs
  // excludes it) - "ดึง BOQ" and the job-count badge are meaningless there
  // regardless of the viewer's own construction permission.
  const showConstructionTab = !visibleTabs || visibleTabs.includes('construction')

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        {!onClose && (
          <button
            onClick={() => router.push(`/dashboard/projects/${projectId}`)}
            className="text-sm text-slate-500 hover:text-indigo-600 w-fit flex gap-1 items-center"
          >
            <ArrowLeft className="h-4 w-4" /> กลับหน้ารายการ
          </button>
        )}

        <PageHeader
          title={
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-2">
                <Hammer className="text-indigo-600" /> แปลง {plot.name}
              </span>
              {canEditConstruction && (
                <button onClick={() => setIsEditModalOpen(true)} className="text-slate-400 hover:text-indigo-600">
                  <Pencil className="h-4 w-4" />
                </button>
              )}
              {plot.is_sellable === false && <Badge tone="neutral">ไม่ขาย</Badge>}
            </span>
          }
          subtitle={`แบบบ้าน: ${plot.house_models?.name || ''}`}
          actions={
            canEditConstruction && showConstructionTab ? (
              <>
                <Button variant="secondary" size="sm" onClick={handleSync} disabled={isPending}>
                  ดึง BOQ
                </Button>
                <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-sm font-bold border border-slate-200">
                  งานทั้งหมด {jobs.length} รายการ
                </span>
              </>
            ) : null
          }
        />
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              tab === t.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <PlotOverviewTab saleDetail={saleDetail} jobs={jobs} jobsDone={jobsDone} canSeeCost={canSeeCost} />
      )}
      {tab === 'sales' && (
        <PlotSalesTab
          key={fetchedAt}
          plotId={plotId}
          projectId={projectId}
          saleDetail={saleDetail}
          saleStatuses={saleStatuses}
          payments={payments}
          canEdit={canEditSales}
          onRefresh={refresh}
        />
      )}
      {tab === 'construction' && (
        <PlotConstructionTab
          jobs={jobs}
          contractors={contractors}
          canEdit={canEditConstruction}
          isPending={isPending}
          priceDrafts={priceDrafts}
          onPriceDraftChange={handlePriceDraftChange}
          onSaveVariablePrice={handleSaveVariablePrice}
          onResetVariablePrice={handleResetVariablePrice}
          onAssign={handleAssign}
          onStatusChange={handleStatusChange}
        />
      )}
      {tab === 'materials' && <PlotMaterialsTab materials={materials} canSeeCost={canSeeCost} />}
      {tab === 'requests' && (
        <PlotWorkRequestsTab plotId={plotId} requests={workRequests} canCreate={canEditSales} />
      )}
      {tab === 'history' && <PlotHistoryTab history={history} />}

      {canEditConstruction && (
        <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="แก้ไขรายละเอียดแปลง">
          <form action={handleUpdatePlot} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">ชื่อแปลง</label>
              <input name="name" required className="w-full" defaultValue={plot.name} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">แบบบ้าน</label>
              <select name="house_model_id" required className="w-full" defaultValue={plot.house_model_id}>
                <option value="" disabled>-- เลือกแบบบ้าน --</option>
                {houseModels.map((m) => (
                  <option key={m.id} value={m.id}>{getHouseModelLabel(m)}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="is_sellable" defaultChecked={plot.is_sellable !== false} className="h-4 w-4 rounded border-slate-300" />
              แปลงนี้เป็นบ้านสำหรับขาย
            </label>
            <p className="-mt-3 text-xs text-slate-500">
              ปิดสำหรับส่วนกลาง ที่รอรถ หรือแปลงที่เป็นช่วง (เช่น &ldquo;25-29&rdquo;) ที่ไม่ใช่บ้านหลังเดียว
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">เนื้อที่ (ตร.ว.)</label>
                <input type="number" min="0" step="0.01" name="land_area_sqwa" className="w-full" defaultValue={plot.land_area_sqwa ?? ''} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">ราคาตั้ง (บาท)</label>
                <input type="number" min="0" step="0.01" name="list_price" className="w-full" defaultValue={plot.list_price ?? ''} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">เลขที่โฉนด</label>
              <input name="title_deed_no" className="w-full" defaultValue={plot.title_deed_no ?? ''} />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="secondary" onClick={() => setIsEditModalOpen(false)}>ยกเลิก</Button>
              <Button type="submit">บันทึก</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
