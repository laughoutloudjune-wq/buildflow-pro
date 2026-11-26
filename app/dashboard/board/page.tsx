import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getProjects } from '@/actions/project-actions'
import { getDashboardSession, permissionsForRole, requireModuleAccess } from '@/lib/auth/route-access'

/** Menu entry "ภาพรวมโครงการ": opens the board of the project you looked at last, else the first running project. */
const BOARD_PROJECT_COOKIE = 'buildflow.board-project'

export default async function BoardEntryPage() {
  await requireModuleAccess(['projects', 'cost_control'])
  // The board is cost control's front page; roles with projects but not cost control (foreman) keep the project list.
  const { role, permissions } = await getDashboardSession()
  if (!permissionsForRole(role, permissions).cost_control) redirect('/dashboard/projects')
  const projects = ((await getProjects({ onlyProjectsPage: true })) || []) as { id: string; status: string }[]
  const remembered = (await cookies()).get(BOARD_PROJECT_COOKIE)?.value
  const pick = projects.find((p) => p.id === remembered) || projects.find((p) => p.status !== 'completed') || projects[0]
  redirect(pick ? `/dashboard/projects/${pick.id}/board` : '/dashboard/projects')
}
