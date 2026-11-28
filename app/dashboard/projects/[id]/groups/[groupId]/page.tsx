import { notFound } from 'next/navigation'
import { getGroupHub } from '@/actions/construction-hubs'
import { getCostBoard } from '@/actions/procurement/cost-board'
import { getDashboardSession, permissionsForRole, requireModuleAccess } from '@/lib/auth/route-access'
import GroupHubClient from './GroupHubClient'

/**
 * Batch hub (e.g. plots 103-107). The same five tabs as a plot, with chips to
 * switch the scope between the whole batch and one plot, so "BOQ per plot" and
 * "BOQ per group" are one table instead of two pages.
 */
export default async function GroupHubPage({ params }: { params: Promise<{ id: string; groupId: string }> }) {
  await requireModuleAccess('projects')
  const { id: projectId, groupId } = await params
  const { role, permissions } = await getDashboardSession()
  const perms = permissionsForRole(role, permissions)
  const canSeeLabor = perms.reports || perms.cost_control

  const hub = await getGroupHub(projectId, groupId)
  if (!hub) notFound()

  let board: Awaited<ReturnType<typeof getCostBoard>> | null = null
  if (perms.cost_control) {
    try {
      board = await getCostBoard({ projectId, plotGroupId: groupId }, { canSeeLabor })
    } catch (e) {
      console.error(e)
    }
  }

  return <GroupHubClient hub={hub} board={board} canSeeLabor={canSeeLabor} canBoq={perms.cost_control} canReview={perms.billing} />
}
