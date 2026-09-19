import { getSalesBoard, getSalesBoardOptions, getSaleStatuses, getSitePlanData } from '@/actions/sales-actions'
import { getOverdueSalePayments } from '@/actions/sale-payments-actions'
import { getDashboardSession, permissionsForRole } from '@/lib/auth/route-access'
import type { ControlScope } from '@/lib/procurement/boqControl'
import SalesBoardPageClient, { type SalesBoardView } from './SalesBoardPageClient'

type SearchParams = { project?: string; group?: string; plots?: string; view?: string }

function resolveView(raw: string | undefined): SalesBoardView {
  return raw === 'table' ? 'table' : raw === 'cards' ? 'cards' : 'map'
}

/**
 * Server component: reads scope + view from the URL and fetches options,
 * the board rows and the status catalogue in one Promise.all - same pattern
 * as app/dashboard/cost-control/page.tsx (SALES_MODULE_PLAN.md §8.2/§5).
 * The site plan (Phase 4) is fetched separately and only when the map view
 * is actually open, since cards/table (the common case) never need it.
 */
export default async function SalesBoardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const { role, permissions: rolePermissions } = await getDashboardSession()
  const canEditSitePlan = permissionsForRole(role, rolePermissions).projects

  let options: Awaited<ReturnType<typeof getSalesBoardOptions>> = { projects: [], plotGroups: [], plots: [] }
  let overduePayments: Awaited<ReturnType<typeof getOverdueSalePayments>> = []
  let initialError: string | null = null

  try {
    const [optionsRes, overdueRes] = await Promise.all([
      getSalesBoardOptions(),
      getOverdueSalePayments().catch(() => []),
    ])
    options = optionsRes
    overduePayments = overdueRes
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดตัวเลือกไม่สำเร็จ'
  }

  const plotIds = params.plots ? params.plots.split(',').filter(Boolean) : []
  const scope: ControlScope = {
    projectId: params.project || options.projects[0]?.id || '',
    plotGroupId: plotIds.length === 0 ? params.group || null : null,
    plotIds,
  }
  const view = resolveView(params.view)

  let board: Awaited<ReturnType<typeof getSalesBoard>> = []
  let statuses: Awaited<ReturnType<typeof getSaleStatuses>> = []
  let sitePlanData: Awaited<ReturnType<typeof getSitePlanData>> | null = null

  if (scope.projectId) {
    try {
      if (view === 'map') {
        const [boardRes, statusesRes, siteRes] = await Promise.all([
          getSalesBoard(scope.projectId),
          getSaleStatuses(),
          getSitePlanData(scope.projectId),
        ])
        board = boardRes
        statuses = statusesRes
        sitePlanData = siteRes
      } else {
        const [boardRes, statusesRes] = await Promise.all([
          getSalesBoard(scope.projectId),
          getSaleStatuses(),
        ])
        board = boardRes
        statuses = statusesRes
      }
    } catch (error) {
      initialError = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ'
    }
  }

  return (
    <SalesBoardPageClient
      options={options}
      scope={scope}
      view={view}
      board={board}
      statuses={statuses}
      overduePayments={overduePayments}
      sitePlanData={sitePlanData}
      canEditSitePlan={canEditSitePlan}
      initialError={initialError}
    />
  )
}
