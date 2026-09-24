'use server'

import { getJobAssignments, getPlotById, getPlotJobsPublic } from '@/actions/job-actions'
import { getHouseModels } from '@/actions/boq-actions'
import { getContractors } from '@/actions/contractor-actions'
import { getPlotMaterialsSummary, getPlotSaleDetail, getPlotSaleHistory, getSaleStatuses } from '@/actions/sales-actions'
import { getWorkRequestsForPlot } from '@/actions/sales-work-requests'
import { getSalePaymentsForSale } from '@/actions/sale-payments-actions'
import { getPromotions } from '@/actions/promotions-actions'
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
  const canSeeCost = role !== 'sales'
  const canEditConstruction = perms.projects
  const canEditSales = perms.sales

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
  let workRequests: Awaited<ReturnType<typeof getWorkRequestsForPlot>> = []
  let payments: Awaited<ReturnType<typeof getSalePaymentsForSale>> = []

  try {
    // job_assignments' own RLS excludes sales entirely (agreed_price_per_unit
    // is a real cost column) - get_plot_jobs_public() is the SECURITY
    // DEFINER, price-free equivalent for that case, not just a stripped copy
    // of the same query.
    const [pData, jData, cData, hmData, saleData, statusesData, promotionsData, historyData, materialsData, workRequestsData] = await Promise.all([
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
    workRequests = workRequestsData

    if (saleData.sale) payments = await getSalePaymentsForSale(saleData.sale.id).catch(() => [])
  } catch (error) {
    console.error(error)
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
        cost: null,
      }))
  const jobsDone = jobs.filter((j) => j.status === 'completed').length

  const materials: PlotMaterialRowView[] = rawMaterials.map((m) => ({
    materialTypeId: m.materialTypeId,
    name: m.name,
    unit: m.unit,
    orderedQty: m.orderedQty,
    receivedQty: m.receivedQty,
    orderedValue: canSeeCost ? m.orderedValue : null,
  }))

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
    canSeeCost,
    canEditConstruction,
    canEditSales,
  }
}

export type PlotDetailBundle = Awaited<ReturnType<typeof getPlotDetailBundle>>
