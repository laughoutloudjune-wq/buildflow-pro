import { getProjects, getProjectsProgress } from '@/actions/project-actions'
import { requireModuleAccess } from '@/lib/auth/route-access'
import ProjectsPageClient from './ProjectsPageClient'

export default async function ProjectsPage() {
  // The layout allows sales through too (for the plot detail page) - this
  // page itself is construction-only.
  await requireModuleAccess('projects')
  const [projects, progress] = await Promise.all([getProjects({ onlyProjectsPage: true }).then((p) => p || []), getProjectsProgress()])

  return <ProjectsPageClient projects={projects} progress={progress} />
}
