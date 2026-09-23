import { getProjects } from '@/actions/project-actions'
import { requireModuleAccess } from '@/lib/auth/route-access'
import ProjectsPageClient from './ProjectsPageClient'

export default async function ProjectsPage() {
  // The layout allows sales through too (for the plot detail page) - this
  // page itself is construction-only.
  await requireModuleAccess('projects')
  const projects = (await getProjects({ onlyProjectsPage: true })) || []

  return <ProjectsPageClient projects={projects} />
}
