import { requireModuleAccess } from '@/lib/auth/route-access'

export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('projects')
  return children
}
