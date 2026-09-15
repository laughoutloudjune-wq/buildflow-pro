import { getBoqControl, getCostControlOptions } from '@/actions/procurement/boq-control'
import { getMaterialsSummaryForProject } from '@/actions/procurement-actions'
import { getLaborLedger } from '@/actions/labor-budget-actions'
import { getDashboardSession, permissionsForRole } from '@/lib/auth/route-access'
import type { ControlScope } from '@/lib/procurement/boqControl'
import CostControlPageClient, { type CostControlTab } from './CostControlPageClient'

type SearchParams = { project?: string; group?: string; plots?: string; tab?: string }

function resolveTab(raw: string | undefined): CostControlTab {
  return raw === 'material-cost' || raw === 'labor-cost' ? raw : 'qty'
}

/**
 * Server component: reads scope + tab from the URL and fetches everything
 * the page needs - options, the rollup, materials cost and labor cost - in
 * one Promise.all, same pattern as app/dashboard/reports/labor-budget/page.tsx.
 *
 * All three data sources are fetched together regardless of which tab is
 * active: the summary tiles above the tabs (BOQ_CONTROL_PLAN.md 8.5) need
 * numbers from all three at once, not just the visible tab's.
 */
export default async function CostControlPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const { role, permissions } = await getDashboardSession()
  const rolePermissions = permissionsForRole(role, permissions)
  const canSeeLabor = rolePermissions.reports || rolePermissions.cost_control

  let options: Awaited<ReturnType<typeof getCostControlOptions>> = { projects: [], plotGroups: [], plots: [] }
  let initialError: string | null = null

  try {
    options = await getCostControlOptions()
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดตัวเลือกไม่สำเร็จ'
  }

  const plotIds = params.plots ? params.plots.split(',').filter(Boolean) : []
  const scope: ControlScope = {
    projectId: params.project || options.projects[0]?.id || '',
    plotGroupId: plotIds.length === 0 ? params.group || null : null,
    plotIds,
  }
  const tab = resolveTab(params.tab)

  let boqControl: Awaited<ReturnType<typeof getBoqControl>> = { rows: [], unassigned: [], outsideBoq: [] }
  let materialsSummary: Awaited<ReturnType<typeof getMaterialsSummaryForProject>> = []
  let laborEntries: Awaited<ReturnType<typeof getLaborLedger>>['entries'] = []

  if (scope.projectId) {
    try {
      const [boqControlRes, materialsRes, laborRes] = await Promise.all([
        getBoqControl(scope),
        getMaterialsSummaryForProject(scope.projectId, { plotGroupId: scope.plotGroupId || undefined, plotIds: scope.plotIds }),
        canSeeLabor ? getLaborLedger({ projectId: scope.projectId, plotGroupId: scope.plotGroupId || undefined }) : Promise.resolve({ entries: [], groups: [] }),
      ])
      boqControl = boqControlRes
      materialsSummary = materialsRes
      // A batch filter (plotGroupId) is pushed into getLaborLedger itself,
      // but an ad-hoc plot selection isn't something that action supports -
      // filter client-visible entries by the plot ids this scope resolved to.
      laborEntries =
        plotIds.length > 0 ? laborRes.entries.filter((e) => e.plotId && plotIds.includes(e.plotId)) : laborRes.entries
    } catch (error) {
      initialError = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ'
    }
  }

  return (
    <CostControlPageClient
      options={options}
      scope={scope}
      tab={tab}
      canSeeLabor={canSeeLabor}
      boqControl={boqControl}
      materialsSummary={materialsSummary}
      laborEntries={laborEntries}
      initialError={initialError}
    />
  )
}
