import { getBatchMaterialStatus, getCostControlOptions } from '@/actions/procurement/boq-control'
import { getCostBoard } from '@/actions/procurement/cost-board'
import { getBoardExtras, type BoardExtras } from '@/actions/construction-hubs'
import { getDashboardSession, permissionsForRole, requireModuleAccess } from '@/lib/auth/route-access'
import ProjectBoardClient from './ProjectBoardClient'

/**
 * Project board: the construction side's front page. One compact row per plot
 * grouped by batch, a short "ต้องดู" list, and the whole-project วัสดุ BOQ tab.
 * It reads the same getCostBoard / boq_control_rollup data the old cost-control
 * overview did; nothing new is stored.
 */
export default async function ProjectBoardPage({ params }: { params: Promise<{ id: string }> }) {
  await requireModuleAccess('cost_control')
  const { id: projectId } = await params
  const { role, permissions } = await getDashboardSession()
  const perms = permissionsForRole(role, permissions)
  const canSeeLabor = perms.reports || perms.cost_control

  let error: string | null = null
  let options: Awaited<ReturnType<typeof getCostControlOptions>> = { projects: [], plotGroups: [], plots: [] }
  let board: Awaited<ReturnType<typeof getCostBoard>> | null = null
  let extras: BoardExtras | null = null
  let batchMaterial: Awaited<ReturnType<typeof getBatchMaterialStatus>> = {}

  try {
    options = await getCostControlOptions()
    const scope = { projectId }
    const [boardRes, extrasRes, batchRes] = await Promise.all([
      getCostBoard(scope, { canSeeLabor }),
      canSeeLabor ? getBoardExtras(projectId).catch((e) => { console.error(e); return null }) : Promise.resolve(null),
      getBatchMaterialStatus(projectId).catch((e) => { console.error(e); return {} }),
    ])
    board = boardRes
    extras = extrasRes
    batchMaterial = batchRes
  } catch (e) {
    error = e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ'
  }

  return (
    <ProjectBoardClient
      projectId={projectId}
      projects={options.projects}
      board={board}
      extras={extras}
      batchMaterial={batchMaterial}
      canSeeLabor={canSeeLabor}
      canBilling={perms.billing}
      error={error}
    />
  )
}
