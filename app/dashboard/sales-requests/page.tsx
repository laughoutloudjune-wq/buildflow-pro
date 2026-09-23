import { getWorkRequestQueue } from '@/actions/sales-work-requests'
import { getContractors } from '@/actions/contractor-actions'
import { getSalesBoardOptions } from '@/actions/sales-actions'
import { permissionsForRole, requireModuleAccess } from '@/lib/auth/route-access'
import SalesRequestsPageClient from './SalesRequestsPageClient'

/**
 * The construction queue (Phase 6, SALES_MODULE_PLAN.md §8.4). Visible to
 * sales (who file requests) and foreman/projects (who work them) - three
 * roles with no single shared module, hence the OR-gate, same reasoning as
 * the plot detail page in Phase 5.
 */
export default async function SalesRequestsPage() {
  const { role, permissions: rolePermissions } = await requireModuleAccess(['sales', 'foreman', 'projects'])
  const canManage = permissionsForRole(role, rolePermissions).projects

  let requests: Awaited<ReturnType<typeof getWorkRequestQueue>> = []
  let contractors: Awaited<ReturnType<typeof getContractors>> = []
  let projects: Awaited<ReturnType<typeof getSalesBoardOptions>>['projects'] = []
  let initialError: string | null = null

  try {
    const [requestsData, contractorsData, optionsData] = await Promise.all([
      getWorkRequestQueue(),
      getContractors(),
      getSalesBoardOptions().catch(() => ({ projects: [], plotGroups: [], plots: [] })),
    ])
    requests = requestsData
    // getContractors() carries total_paid/total_retention (construction
    // money, M-03) - this page is reachable by sales, and only needs
    // contractor names for the assign-to picker here.
    contractors = contractorsData.map((c) => ({ ...c, total_paid: 0, total_retention: 0 }))
    projects = optionsData.projects
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'โหลดข้อมูลไม่สำเร็จ'
  }

  return (
    <SalesRequestsPageClient
      initialRequests={requests}
      contractors={contractors}
      projects={projects}
      canManage={canManage}
      initialError={initialError}
    />
  )
}
