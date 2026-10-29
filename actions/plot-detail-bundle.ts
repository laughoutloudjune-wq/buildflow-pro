'use server'

import { getJobAssignments, getPlotById, getPlotJobsPublic } from '@/actions/job-actions'
import { getHouseModels } from '@/actions/boq-actions'
import { getContractors } from '@/actions/contractor-actions'
import { getPlotMaterialsSummary, getPlotSaleDetail, getPlotSaleHistory, getSaleStatuses } from '@/actions/sales-actions'
import { getWorkRequestsForPlot } from '@/actions/sales-work-requests'
import { getSalePaymentsForSale } from '@/actions/sale-payments-actions'
import { getPromotions } from '@/actions/promotions-actions'
import { getPlotSalePromotionItems } from '@/actions/plot-sale-promotion-items'
import { getPlotProgressCurve, type PlotProgressCurve } from '@/actions/plot-progress-curve'
import { getPlotPhaseSchedule, type PlotPhaseScheduleRow } from '@/actions/plot-phase-schedule'
import { getPlotStockTrail, type PlotStockTrail } from '@/actions/plot-stock-trail-actions'
import { createClient } from '@/lib/supabase/server'
import { fetchLatestJobProgress, fetchPlannedProgress, type JobProgress } from '@/actions/_shared/job-progress'
import { fetchPlotExtraWork, fetchPlotRequestedQty, type PlotExtraWorkRow } from '@/actions/_shared/plot-cost'
import { expectedFromJobPlans, expectedPercentAt } from '@/lib/cost-control/progress'
import { permissionsForRole, requireModuleAccess } from '@/lib/auth/route-access'
import type { PlotJobRow, PlotMaterialRowView } from '@/lib/types/plotDetail'

/**
 * Everything PlotDetailPageClient needs, gathered and cost-stripped once.
 * Shared by the full page (app/dashboard/projects/[id]/[plotId]/page.tsx)
 * and the map's quick-view modal (components/plots/PlotDetailModal.tsx) so
 * there is exactly one place that decides canSeeCost and strips cost fields
 * before they leave the server - see that page's own comment for why this
 * matters (D2: sales sees price, never cost).
 */
export async function getPlotDetailBundle(projectId: string, plotId: string) {
  const { role, permissions: rolePermissions } = await requireModuleAccess(['projects', 'sales'])
  const perms = permissionsForRole(role, rolePermissions)
  const canSeeCost = role !== 'sales' && role !== 'sales_exec'
  const canEditConstruction = perms.projects
  const canEditSales = perms.sales
  const quickLinks = plotQuickLinks(perms, projectId, plotId)

  let plot: Awaited<ReturnType<typeof getPlotById>> = null
  let rawJobs: Awaited<ReturnType<typeof getJobAssignments>> = []
  let safeJobs: Awaited<ReturnType<typeof getPlotJobsPublic>> = []
  let contractors: Awaited<ReturnType<typeof getContractors>> = []
  let houseModels: Awaited<ReturnType<typeof getHouseModels>> = []
  let saleDetail: Awaited<ReturnType<typeof getPlotSaleDetail>> = { sale: null, customer: null }
  let saleStatuses: Awaited<ReturnType<typeof getSaleStatuses>> = []
  let promotions: Awaited<ReturnType<typeof getPromotions>> = []
  let history: Awaited<ReturnType<typeof getPlotSaleHistory>> = []
  let rawMaterials: Awaited<ReturnType<typeof getPlotMaterialsSummary>> = []
  let stockTrail: PlotStockTrail = { boq: [], entries: [] }
  let workRequests: Awaited<ReturnType<typeof getWorkRequestsForPlot>> = []
  let payments: Awaited<ReturnType<typeof getSalePaymentsForSale>> = []
  let promotionItems: Awaited<ReturnType<typeof getPlotSalePromotionItems>> = []
  let progressCurve: PlotProgressCurve = { startDate: null, targetDate: null, totalBoqValue: 0, actualPoints: [], phaseMilestones: [], today: new Date().toISOString() }
  let phaseSchedule: PlotPhaseScheduleRow[] = []

  try {
    // job_assignments' own RLS excludes sales entirely (agreed_price_per_unit
    // is a real cost column) - get_plot_jobs_public() is the SECURITY
    // DEFINER, price-free equivalent for that case, not just a stripped copy
    // of the same query.
    const [pData, jData, cData, hmData, saleData, statusesData, promotionsData, historyData, materialsData, workRequestsData, progressCurveData, phaseScheduleData, stockTrailData] = await Promise.all([
      getPlotById(plotId),
      canSeeCost ? getJobAssignments(plotId) : getPlotJobsPublic(plotId),
      getContractors(),
      getHouseModels(),
      getPlotSaleDetail(plotId),
      getSaleStatuses().catch(() => []),
      getPromotions().catch(() => []),
      getPlotSaleHistory(plotId),
      getPlotMaterialsSummary(plotId, projectId).catch(() => []),
      getWorkRequestsForPlot(plotId).catch(() => []),
      // Construction-only (D2) - a sales viewer never sees this chart, so
      // there's no reason to even compute it for them.
      canSeeCost
        ? getPlotProgressCurve(plotId).catch(() => progressCurve)
        : Promise.resolve(progressCurve),
      canSeeCost
        ? getPlotPhaseSchedule(plotId).catch(() => phaseSchedule)
        : Promise.resolve(phaseSchedule),
      getPlotStockTrail(plotId, projectId).catch(() => stockTrail),
    ])
    plot = pData
    if (canSeeCost) {
      rawJobs = (jData || []) as Awaited<ReturnType<typeof getJobAssignments>>
    } else {
      safeJobs = (jData || []) as Awaited<ReturnType<typeof getPlotJobsPublic>>
    }
    // getContractors() carries total_paid/total_retention (construction
    // money, M-03) - strip those for sales same as jobs/materials/history
    // below. Only names/type are needed here (contractor picker).
    contractors = canSeeCost
      ? cData || []
      : (cData || []).map((c) => ({ ...c, total_paid: 0, total_retention: 0 }))
    houseModels = hmData || []
    saleDetail = saleData
    saleStatuses = statusesData
    promotions = promotionsData
    history = historyData
    rawMaterials = materialsData
    stockTrail = stockTrailData
    workRequests = workRequestsData
    progressCurve = progressCurveData
    phaseSchedule = phaseScheduleData

    if (saleData.sale) {
      payments = await getSalePaymentsForSale(saleData.sale.id).catch(() => [])
      promotionItems = await getPlotSalePromotionItems(saleData.sale.id).catch(() => [])
    }
  } catch (error) {
    console.error(error)
  }

  // Progress, extra work and requested quantities are cost-side figures, so
  // they are only fetched for viewers who may see cost (D2). Each is a soft
  // source: a failure leaves the older tabs working.
  let jobProgress = new Map<string, JobProgress>()
  let extraWork: PlotExtraWorkRow[] = []
  let requestedByMaterial = new Map<number, number>()
  let plannedByJob = new Map<string, number>()
  if (canSeeCost) {
    try {
      const supabase = await createClient()
      ;[jobProgress, extraWork, requestedByMaterial, plannedByJob] = await Promise.all([
        fetchLatestJobProgress(supabase, { jobIds: rawJobs.map((j) => j.id as string) }).catch((e) => {
          console.error(e)
          return new Map<string, JobProgress>()
        }),
        fetchPlotExtraWork(supabase, plotId).catch((e) => {
          console.error(e)
          return [] as PlotExtraWorkRow[]
        }),
        fetchPlotRequestedQty(supabase, projectId, plotId).catch((e) => {
          console.error(e)
          return new Map<number, number>()
        }),
        fetchPlannedProgress(supabase, { jobIds: rawJobs.map((j) => j.id as string) }, progressCurve.today.slice(0, 10)),
      ])
    } catch (error) {
      console.error(error)
    }
  }

  const jobs: PlotJobRow[] = canSeeCost
    ? rawJobs.map((job) => {
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
          tradeName: (Array.isArray(job.boq_master?.contractor_types) ? job.boq_master?.contractor_types[0]?.name : job.boq_master?.contractor_types?.name) || null,
          progressPercent: jobProgress.get(job.id as string)?.percent ?? null,
          progressSource: jobProgress.get(job.id as string)?.source ?? null,
          cost: {
            contractorName: job.contractors?.name || null,
            agreedPricePerUnit: agreedPrice,
            boqPricePerUnit: boqPrice,
            effectivePrice,
            totalBoq,
            paid,
          },
        }
      })
    : safeJobs.map((job) => ({
        id: job.id,
        status: job.status,
        itemName: job.item_name || '',
        unit: job.unit || '',
        quantity: job.quantity || 0,
        contractorId: job.contractor_id,
        tradeName: null,
        progressPercent: null,
        progressSource: null,
        cost: null,
      }))
  const jobsDone = jobs.filter((j) => j.status === 'completed').length

  // The batch this plot is built with ("กลุ่ม 120-124"), shown beside the house type.
  let plotGroupName: string | null = null
  try {
    const supabase = await createClient()
    const { data } = await supabase.from('plot_group_members').select('plot_groups (name)').eq('plot_id', plotId).maybeSingle()
    const g = (data as { plot_groups: { name: string | null } | { name: string | null }[] | null } | null)?.plot_groups
    plotGroupName = (Array.isArray(g) ? g[0]?.name : g?.name) || null
  } catch (error) {
    console.error(error)
  }

  // The weekly plan is the realistic schedule, so it wins when the plot has
  // one; otherwise fall back to the phase schedule / target-date ramp.
  const planExpected = expectedFromJobPlans(
    jobs.filter((j) => j.cost).map((j) => ({ value: j.cost!.totalBoq, planned: plannedByJob.get(j.id) ?? null }))
  )
  const expectedPercent = planExpected ?? expectedPercentAt({
    today: progressCurve.today,
    startDate: progressCurve.startDate,
    targetDate: progressCurve.targetDate,
    phases: progressCurve.phaseMilestones.map((p) => ({ plannedStart: p.plannedStart, plannedEnd: p.plannedEnd, weight: p.weight })),
  })

  // One row per material that was bought for, handed out to, or planned
  // for this plot - PO figures, store withdrawals / straight-to-plot
  // deliveries, and BOQ side by side.
  const materialRows = new Map<number, PlotMaterialRowView>()
  const rowFor = (id: number, name: string, unit: string) => {
    let row = materialRows.get(id)
    if (!row) {
      row = {
        materialTypeId: id,
        name,
        unit,
        requestedQty: 0,
        orderedQty: 0,
        receivedQty: 0,
        orderedValue: canSeeCost ? 0 : null,
        sources: [],
        plannedQty: null,
        allowanceQty: null,
        issuedQty: 0,
        issuedValue: canSeeCost ? 0 : null,
        directQty: 0,
        stockEntries: [],
      }
      materialRows.set(id, row)
    }
    return row
  }
  for (const m of rawMaterials) {
    const row = rowFor(m.materialTypeId, m.name, m.unit)
    row.orderedQty = m.orderedQty
    row.receivedQty = m.receivedQty
    row.orderedValue = canSeeCost ? m.orderedValue : null
    row.sources = m.sources
  }
  for (const b of stockTrail.boq) {
    const row = rowFor(b.materialTypeId, b.name, b.unit)
    row.plannedQty = b.plannedQty
    row.allowanceQty = b.allowanceQty
  }
  for (const e of stockTrail.entries) {
    const row = rowFor(e.materialTypeId, e.materialName, e.unit)
    if (e.kind === 'issue') row.issuedQty += e.plotQty
    else row.directQty += e.plotQty
    row.stockEntries.push(e)
  }
  // Baht for store withdrawals, so a plot's materials cost includes what its
  // contractors drew from store stock (the store PO itself carries no plot).
  if (canSeeCost) {
    try {
      const supabase = await createClient()
      const { data } = await supabase.rpc('boq_control_issued_value', { p_project_id: projectId, p_scope: { plot_ids: [plotId] } })
      for (const v of (data as { material_type_id: number; issued_value: number | string }[] | null) || []) {
        const row = materialRows.get(v.material_type_id)
        if (row) row.issuedValue = Number(v.issued_value) || 0
      }
    } catch (error) {
      console.error(error)
    }
  }
  for (const [materialTypeId, qty] of requestedByMaterial) {
    const known = materialRows.get(materialTypeId)
    if (known) {
      known.requestedQty = qty
      continue
    }
    // A requested material nothing else mentions yet still needs its row.
    const supabase = await createClient()
    const { data: mt } = await supabase.from('material_types').select('name, unit').eq('id', materialTypeId).maybeSingle()
    rowFor(materialTypeId, mt?.name || '-', mt?.unit || '').requestedQty = qty
  }
  const materials = Array.from(materialRows.values()).sort((a, b) => a.name.localeCompare(b.name, 'th'))

  const historyView = history.map((h) => ({
    ...h,
    amount: canSeeCost ? h.amount : null,
    jobs: h.jobs?.map((j) => ({ ...j, amount: canSeeCost ? j.amount : null })),
  }))

  return {
    // Changes on every real fetch of this function, regardless of whether
    // the underlying data changed - used as a remount key for tabs with
    // uncontrolled (defaultValue) fields, so a save-then-refresh always
    // shows the new values instead of racing a manually-timed counter.
    fetchedAt: Date.now(),
    projectId,
    plotId,
    plot,
    jobs,
    jobsDone,
    contractors,
    houseModels,
    saleDetail,
    saleStatuses,
    promotions,
    history: historyView,
    materials,
    workRequests,
    payments,
    promotionItems,
    progressCurve,
    phaseSchedule,
    extraWork,
    expectedPercent,
    plotGroupName,
    canSeeCost,
    canEditConstruction,
    canEditSales,
    quickLinks,
  }
}

export type PlotQuickLink = { key: 'progress' | 'dc' | 'purchase' | 'withdraw'; label: string; href: string }

/** "Start from here" buttons on the plot page: each opens its form with this
 * project and plot already chosen. Only forms the viewer's role can open. */
function plotQuickLinks(perms: ReturnType<typeof permissionsForRole>, projectId: string, plotId: string): PlotQuickLink[] {
  if (!perms.projects) return []
  const qs = `projectId=${encodeURIComponent(projectId)}&plotId=${encodeURIComponent(plotId)}`
  const links: PlotQuickLink[] = []
  if (perms.foreman) links.push({ key: 'progress', label: 'เบิกงวด', href: `/dashboard/foreman/request?${qs}` })
  else if (perms.billing) links.push({ key: 'progress', label: 'เบิกงวด', href: `/dashboard/billing/request?${qs}` })
  if (perms.foreman) links.push({ key: 'dc', label: 'งานเพิ่ม (DC)', href: `/dashboard/foreman/create-dc?${qs}` })
  if (perms.foreman) links.push({ key: 'purchase', label: 'ขอซื้อ', href: `/dashboard/foreman/purchase-request/create?${qs}` })
  else if (perms.procurement) links.push({ key: 'purchase', label: 'ขอซื้อ', href: `/dashboard/procurement/requests/create?${qs}` })
  if (perms.materials) links.push({ key: 'withdraw', label: 'เบิกของ', href: `/dashboard/stock?withdraw=1&${qs}` })
  return links
}

export type PlotDetailBundle = Awaited<ReturnType<typeof getPlotDetailBundle>>
