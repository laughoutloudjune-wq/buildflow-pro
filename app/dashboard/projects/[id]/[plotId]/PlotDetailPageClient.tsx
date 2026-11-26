'use client'

import { useState, useTransition } from 'react'
import { useUrlState } from '@/lib/use-url-state'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Hammer, History, LayoutGrid, Pencil, Plus, Tag } from 'lucide-react'
import Link from 'next/link'
import { useInFrame } from '@/lib/use-in-frame'
import { Button, ButtonLink } from '@/components/ui/Button'
import type { PlotQuickLink } from '@/actions/plot-detail-bundle'
import { PageHeader } from '@/components/ui/PageHeader'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { Badge } from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useToast } from '@/components/ui/Toast'
import PlotKeyFacts from '@/components/plots/PlotKeyFacts'
import PlotOverviewTab from '@/components/plots/PlotOverviewTab'
import PlotSalesTab from '@/components/plots/PlotSalesTab'
import PlotConstructionTab from '@/components/plots/PlotConstructionTab'
import PlotMaterialsTab from '@/components/plots/PlotMaterialsTab'
import type { PlotExtraWorkRow } from '@/actions/_shared/plot-cost'
import { progressState, summarizeProgress } from '@/lib/cost-control/progress'
import PlotHistoryTab from '@/components/plots/PlotHistoryTab'
import PlotWorkRequestsTab from '@/components/plots/PlotWorkRequestsTab'
import { BackButton } from '@/components/ui/BackButton'
import BillsPanel from '@/components/construction/BillsPanel'
import EmbeddedFrameModal from '@/components/construction/EmbeddedFrameModal'
import JobDetailModal from '@/components/construction/JobDetailModal'
import PlotCostTab from '@/components/construction/PlotCostTab'
import { MONEY, Tile, baht, pct } from '@/components/construction/vocab'
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
import type { Promotion } from '@/actions/promotions-actions'
import type { PlotSalePromotionItem } from '@/actions/plot-sale-promotion-items'
import type { PlotProgressCurve } from '@/actions/plot-progress-curve'
import type { PlotPhaseScheduleRow } from '@/actions/plot-phase-schedule'
import type { WorkRequestRow } from '@/actions/sales-work-requests'
import type { SalePaymentRow } from '@/actions/sale-payments-actions'
import { houseTypeLabel } from '@/lib/house-type'
import type { PlotHistoryRowView, PlotJobRow, PlotMaterialRowView } from '@/lib/types/plotDetail'
import { useDepartment } from '@/components/layout/DepartmentContext'

type Plot = Awaited<ReturnType<typeof getPlotById>>
type Contractor = Awaited<ReturnType<typeof getContractors>>[number]
type HouseModel = Awaited<ReturnType<typeof getHouseModels>>[number]

export type PlotDetailTab = 'overview' | 'sales' | 'construction' | 'bills' | 'dc' | 'materials' | 'cost' | 'requests' | 'history'
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
  plotGroupName,
  plotGroup,
  jobs: initialJobs,
  jobsDone,
  contractors,
  houseModels,
  saleDetail,
  saleStatuses,
  promotions,
  promotionItems,
  history,
  materials,
  workRequests,
  payments,
  progressCurve,
  phaseSchedule,
  extraWork,
  expectedPercent,
  canSeeCost,
  canEditConstruction,
  canEditSales,
  canReviewBills = false,
  quickLinks = [],
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
  plotGroupName?: string | null
  /** The batch and its plots, for the previous / next plot arrows. */
  plotGroup?: { id: string; name: string; plots: { id: string; name: string }[] } | null
  jobs: PlotJobRow[]
  jobsDone: number
  contractors: Contractor[]
  houseModels: HouseModel[]
  saleDetail: PlotSaleDetail
  saleStatuses: SaleStatus[]
  promotions: Promotion[]
  promotionItems: PlotSalePromotionItem[]
  history: PlotHistoryRowView[]
  materials: PlotMaterialRowView[]
  workRequests: WorkRequestRow[]
  payments: SalePaymentRow[]
  progressCurve: PlotProgressCurve
  phaseSchedule: PlotPhaseScheduleRow[]
  extraWork: PlotExtraWorkRow[]
  expectedPercent: number | null
  canSeeCost: boolean
  canEditConstruction: boolean
  canEditSales: boolean
  /** May approve bills (billing module): waiting bills open in the review popup. */
  canReviewBills?: boolean
  /** Forms that open with this plot already chosen (getPlotDetailBundle). */
  quickLinks?: PlotQuickLink[]
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
  const { theme } = useDepartment()
  const refresh = onRefresh ?? (() => router.refresh())
  const toast = useToast()
  const [isPending, startTransition] = useTransition()
  const inFrame = useInFrame()
  const [rawTab, setTab] = useUrlState<Tab>('tab', 'overview')

  const [jobs, setJobs] = useState<PlotJobRow[]>(initialJobs)
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>(() => buildPriceDrafts(initialJobs))

  // Recomputed from the live job list so a price change (which moves the
  // contract value) is reflected without a full reload.
  const liveProgress = (() => {
    const summary = summarizeProgress(
      jobs.filter((j) => j.cost).map((j) => ({ value: j.cost!.totalBoq, progressPercent: j.progressPercent, paid: j.cost!.paid }))
    )
    return { summary, health: progressState(summary, expectedPercent) }
  })()

  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  const [frame, setFrame] = useState<PlotQuickLink | null>(null)
  const [billsRefresh, setBillsRefresh] = useState(0)
  const [isSyncConfirmOpen, setIsSyncConfirmOpen] = useState(false)

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
        // Progress is not part of the raw job rows; keep what the bundle gave us.
        progressPercent: jobs.find((j) => j.id === job.id)?.progressPercent ?? null,
        progressSource: jobs.find((j) => j.id === job.id)?.progressSource ?? null,
        tradeName: job.boq_master?.contractor_types?.name ?? jobs.find((j) => j.id === job.id)?.tradeName ?? null,
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
    // Choosing a contractor starts the job (cleared -> รอเริ่ม); the screen
    // shows the status the server actually saved.
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, contractorId: contractorId || null } : j)))
    startTransition(async () => {
      const { status } = await assignContractor(jobId, contractorId, plotId, projectId)
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, status } : j)))
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
    setIsSyncConfirmOpen(true)
  }

  const handleConfirmSync = () => {
    if (!plot) return
    setIsSyncConfirmOpen(false)
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
      toast.error('กรุณาใส่ราคาต่อหน่วยที่ถูกต้อง')
      return
    }
    setJobs((prev) => prev.map((j) => (j.id === job.id && j.cost ? { ...j, cost: { ...j.cost, agreedPricePerUnit: next } } : j)))
    startTransition(async () => {
      await updateAgreedPricePerUnit(job.id, next, plotId, projectId)
    })
  }

  const handleSavePrice = (jobId: string, next: number | null) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId && j.cost ? { ...j, cost: { ...j.cost, agreedPricePerUnit: next, effectivePrice: next ?? j.cost.boqPricePerUnit, totalBoq: j.quantity * (next ?? j.cost.boqPricePerUnit) } } : j)))
    setPriceDrafts((prev) => ({ ...prev, [jobId]: next == null ? '' : String(next) }))
    startTransition(async () => {
      await updateAgreedPricePerUnit(jobId, next, plotId, projectId)
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

  const hubTabs = canSeeCost && canEditConstruction && !visibleTabs && !onClose
  // Links to the hub-only tabs (bills / DC / cost) fall back to ภาพรวม for viewers without them.
  const tab: Tab = !hubTabs && (rawTab === 'bills' || rawTab === 'dc' || rawTab === 'cost') ? 'overview' : rawTab
  const ALL_TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
    { key: 'overview', label: 'ภาพรวม', icon: LayoutGrid },
    ...(hubTabs ? [] : ([{ key: 'sales', label: 'การขาย', icon: Tag }] as { key: Tab; label: string; icon: typeof LayoutGrid }[])),
    { key: 'construction', label: hubTabs ? 'งานและช่าง' : 'งานก่อสร้าง', icon: Hammer },
    ...(hubTabs
      ? ([
          { key: 'bills', label: 'ใบเบิก', icon: ClipboardList },
          { key: 'dc', label: 'งานเพิ่ม (DC)', icon: Plus },
        ] as { key: Tab; label: string; icon: typeof LayoutGrid }[])
      : []),
    { key: 'materials', label: hubTabs ? 'วัสดุ BOQ' : 'วัสดุ', icon: ClipboardList },
    ...(hubTabs ? ([{ key: 'cost', label: 'ต้นทุน', icon: Tag }] as { key: Tab; label: string; icon: typeof LayoutGrid }[]) : []),
    ...(hubTabs ? ([{ key: 'sales', label: 'การขาย', icon: Tag }] as { key: Tab; label: string; icon: typeof LayoutGrid }[]) : []),
    { key: 'requests', label: 'คำขอจากฝ่ายขาย', icon: ClipboardCheck },
    { key: 'history', label: 'ประวัติ', icon: History },
  ]
  const TABS = visibleTabs ? ALL_TABS.filter((t) => visibleTabs.includes(t.key)) : ALL_TABS
  // The sales map's quick-view has no งานก่อสร้าง tab at all (visibleTabs
  // excludes it) - "ดึง BOQ" and the job-count badge are meaningless there
  // regardless of the viewer's own construction permission.
  const showConstructionTab = !visibleTabs || visibleTabs.includes('construction')

  // Previous / next plot of the same batch (plot hub only).
  const batchNeighbors = (() => {
    const list = plotGroup?.plots || []
    const at = list.findIndex((p) => p.id === plotId)
    return at < 0 ? { prev: null, next: null } : { prev: list[at - 1] ?? null, next: list[at + 1] ?? null }
  })()
  // Hub tiles. Same sources as the board row, so the two never disagree.
  const hubContract = jobs.reduce((sum, j) => sum + (j.cost?.totalBoq ?? 0), 0)
  const hubPaid = jobs.reduce((sum, j) => sum + (j.cost?.paid ?? 0), 0)
  const hubDc = extraWork.filter((e) => e.status === 'approved').reduce((sum, e) => sum + e.value, 0)
  const hubMaterial = materials.reduce((sum, m) => sum + (m.issuedValue ?? 0), 0)
  const paidNotDone = jobs.filter((j) => j.cost && j.cost.totalBoq > 0 && j.cost.paid >= j.cost.totalBoq - 0.005 && j.status !== 'completed')
  const frameLink = frame

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        {!onClose && !inFrame && <BackButton fallbackHref={`/dashboard/projects/${projectId}/board`} label="กลับ" />}
        {!onClose && (
          <Breadcrumb
            items={[
              { label: 'โครงการ', href: '/dashboard/projects' },
              { label: plot?.projects?.name ?? 'โครงการ', href: `/dashboard/projects/${projectId}` },
              { label: `แปลง ${plot?.name ?? ''}` },
            ]}
          />
        )}

        <PageHeader
          title={
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-2">
                <Hammer className="text-slate-500" aria-hidden /> แปลง {plot.name}
              </span>
              {canEditConstruction && (
                <button onClick={() => setIsEditModalOpen(true)} aria-label="แก้ไขข้อมูลแปลง" title="แก้ไขข้อมูลแปลง" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <Pencil className="h-4 w-4" />
                </button>
              )}
              {plot.is_sellable === false && <Badge tone="neutral">ไม่ขาย</Badge>}
            </span>
          }
          subtitle={`แบบบ้าน: ${houseTypeLabel(plot.house_models?.name, plot.house_models?.code) || '-'}${plotGroupName ? ` · กลุ่ม ${plotGroupName}` : ''}${jobs.length > 0 ? ` · งานก่อสร้างเสร็จ ${jobsDone}/${jobs.length} รายการ` : ''}`}
          actions={
            canEditConstruction && showConstructionTab ? (
              <>
                {hubTabs && batchNeighbors.prev && (
                  <Link href={`/dashboard/projects/${projectId}/${batchNeighbors.prev.id}?tab=${tab}`} className="inline-flex items-center rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" title={`แปลงก่อนหน้าในกลุ่ม: ${batchNeighbors.prev.name}`}>
                    <ChevronLeft className="h-4 w-4" aria-hidden /> {batchNeighbors.prev.name}
                  </Link>
                )}
                {hubTabs && batchNeighbors.next && (
                  <Link href={`/dashboard/projects/${projectId}/${batchNeighbors.next.id}?tab=${tab}`} className="inline-flex items-center rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" title={`แปลงถัดไปในกลุ่ม: ${batchNeighbors.next.name}`}>
                    {batchNeighbors.next.name} <ChevronRight className="h-4 w-4" aria-hidden />
                  </Link>
                )}
                {quickLinks.map((link) =>
                  hubTabs && link.key !== 'withdraw' ? (
                    <Button key={link.key} variant="secondary" size="sm" onClick={() => setFrame(link)}>
                      <Plus className="h-3.5 w-3.5" aria-hidden /> {link.key === 'purchase' ? 'ขอซื้อวัสดุ' : link.label}
                    </Button>
                  ) : (
                    <ButtonLink key={link.key} href={link.href} variant="secondary" size="sm">
                      {link.label}
                    </ButtonLink>
                  )
                )}
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

      <PlotKeyFacts
        saleDetail={saleDetail}
        jobsDone={jobsDone}
        jobsTotal={jobs.length}
        targetCompletionDate={plot.target_completion_date ?? null}
        landAreaSqwa={plot.land_area_sqwa ?? null}
      />

      {hubTabs && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Tile label={MONEY.contract} value={baht(hubContract)} />
            <Tile label={MONEY.paid} value={baht(hubPaid)} sub={hubContract > 0 ? `${pct((hubPaid / hubContract) * 100)} ของสัญญา` : undefined} />
            <Tile label={MONEY.left} value={baht(Math.max(0, hubContract - hubPaid))} />
            <Tile label={MONEY.dc} value={baht(hubDc)} />
            <Tile label={MONEY.material} value={baht(hubMaterial)} sub="เบิกจากสโตร์" />
          </div>
          {paidNotDone.length > 0 && (
            <div className="flex flex-wrap items-start gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-800 ring-1 ring-inset ring-red-200" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                จ่ายครบแล้วแต่สถานะยังไม่เสร็จ {paidNotDone.length} งาน:{' '}
                {paidNotDone.slice(0, 3).map((j, i) => (
                  <button key={j.id} type="button" onClick={() => { setTab('construction'); setOpenJobId(j.id) }} className="font-medium underline">
                    {i > 0 ? ', ' : ''}
                    {j.itemName}
                  </button>
                ))}
                {paidNotDone.length > 3 ? ` และอีก ${paidNotDone.length - 3} งาน` : ''}
              </span>
            </div>
          )}
        </>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="หมวดข้อมูลแปลง">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
              tab === t.key ? theme.tab : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <PlotOverviewTab
          saleDetail={saleDetail}
          jobs={jobs}
          jobsDone={jobsDone}
          canSeeCost={canSeeCost}
          progressCurve={progressCurve}
          promotionItems={promotionItems}
          plotId={plotId}
          projectId={projectId}
          phaseSchedule={phaseSchedule}
          canEditConstruction={canEditConstruction}
        />
      )}
      {tab === 'sales' && (
        <PlotSalesTab
          key={fetchedAt}
          plotId={plotId}
          projectId={projectId}
          saleDetail={saleDetail}
          saleStatuses={saleStatuses}
          promotions={promotions}
          promotionItems={promotionItems}
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
          progressSummary={liveProgress.summary}
          expectedPercent={expectedPercent}
          progressHealth={liveProgress.health}
          extraWork={extraWork}
          onOpenJob={hubTabs ? setOpenJobId : undefined}
        />
      )}
      {hubTabs && tab === 'bills' && <BillsPanel projectId={projectId} plotIds={[plotId]} kind="main" showPlots={false} refreshKey={billsRefresh} canReview={canReviewBills} />}
      {hubTabs && tab === 'dc' && <BillsPanel projectId={projectId} plotIds={[plotId]} kind="dc" showPlots={false} refreshKey={billsRefresh} canReview={canReviewBills} />}
      {hubTabs && tab === 'cost' && <PlotCostTab jobs={jobs} extraWork={extraWork} materials={materials} />}
      {tab === 'materials' && <PlotMaterialsTab plotId={plotId} />}
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
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">วันที่คาดว่าจะแล้วเสร็จ (สำหรับกราฟความคืบหน้า)</label>
              <input type="date" name="target_completion_date" className="w-full" defaultValue={plot.target_completion_date ?? ''} />
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button type="button" variant="secondary" onClick={() => setIsEditModalOpen(false)}>ยกเลิก</Button>
              <Button type="submit">บันทึก</Button>
            </div>
          </form>
        </Modal>
      )}

      {hubTabs && (
        <JobDetailModal
          job={jobs.find((j) => j.id === openJobId) ?? null}
          contractors={contractors}
          canEdit={canEditConstruction}
          plotId={plotId}
          projectId={projectId}
          onAssign={handleAssign}
          onStatus={handleStatusChange}
          onSavePrice={handleSavePrice}
          onClose={() => setOpenJobId(null)}
        />
      )}
      {hubTabs && frameLink && (
        <EmbeddedFrameModal
          isOpen
          title={frameLink.key === 'progress' ? `เบิกงวด · แปลง ${plot.name}` : frameLink.key === 'dc' ? `งานเพิ่ม (DC) · แปลง ${plot.name}` : `ขอซื้อวัสดุ · แปลง ${plot.name}`}
          src={frameLink.href}
          stayWhile={(p) => p === frameLink.href.split('?')[0]}
          onClose={() => setFrame(null)}
          onDone={() => {
            setFrame(null)
            setBillsRefresh((n) => n + 1)
            refresh()
          }}
        />
      )}

      <ConfirmDialog
        isOpen={isSyncConfirmOpen}
        title="ดึงรายการ BOQ"
        message="ต้องการดึงรายการ BOQ ล่าสุดมาเพิ่มใช่ไหม?"
        confirmLabel={isPending ? 'กำลังดึงข้อมูล...' : 'ดึง BOQ'}
        cancelLabel="ยกเลิก"
        tone="primary"
        busy={isPending}
        onCancel={() => setIsSyncConfirmOpen(false)}
        onConfirm={handleConfirmSync}
      />
    </div>
  )
}
