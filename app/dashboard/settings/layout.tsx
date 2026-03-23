import { requireDashboardRole } from '@/lib/auth/route-access'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardRole(['admin'])
  return children
}
