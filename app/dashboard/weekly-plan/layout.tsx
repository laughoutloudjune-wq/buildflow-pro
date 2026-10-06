import { requireModuleAccess } from '@/lib/auth/route-access'

export default async function WeeklyPlanLayout({ children }: { children: React.ReactNode }) {
  // Construction side only (admin, pm, foreman); sales, sales_exec and
  // accountant have `projects` off and are redirected.
  await requireModuleAccess('projects')
  return children
}
