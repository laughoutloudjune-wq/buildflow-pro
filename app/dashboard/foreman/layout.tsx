import ForemanShell from '@/components/layout/ForemanShell'
import { requireModuleAccess } from '@/lib/auth/route-access'

export default async function ForemanLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('foreman')
  return <ForemanShell>{children}</ForemanShell>
}
