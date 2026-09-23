import { requireModuleAccess } from '@/lib/auth/route-access'

// Widened to let sales through (H-08) - the sales board links straight to a
// plot page, which getPlotDetailBundle already cost-strips for that role.
// The projects list and project-detail pages aren't for sales though, so
// each of those two pages gates itself back down to 'projects' - only
// [id]/[plotId] is meant to be reachable here by both.
export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess(['projects', 'sales'])
  return children
}
