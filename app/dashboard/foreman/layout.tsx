import ForemanShell from '@/components/layout/ForemanShell'
import { requireDashboardRole } from '@/lib/auth/route-access'

export default async function ForemanLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardRole(['admin', 'foreman'])
  return <ForemanShell>{children}</ForemanShell>
}
