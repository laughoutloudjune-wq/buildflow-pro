import { requireModuleAccess } from '@/lib/auth/route-access'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('settings')
  return children
}
