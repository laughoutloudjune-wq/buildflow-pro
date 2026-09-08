import { getProjects } from '@/actions/project-actions'
import ProjectsPageClient from './ProjectsPageClient'

export default async function ProjectsPage() {
  const projects = (await getProjects()) || []

  return <ProjectsPageClient projects={projects} />
}
