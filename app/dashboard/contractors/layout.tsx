import { requireDashboardRole } from '@/lib/auth/route-access'

export default async function ContractorsLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardRole(['admin', 'pm'])
  return children
}
