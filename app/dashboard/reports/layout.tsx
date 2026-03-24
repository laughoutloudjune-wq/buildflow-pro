import { requireModuleAccess } from '@/lib/auth/route-access'

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('reports')
  return children
}
