import { requireModuleAccess } from '@/lib/auth/route-access'

export default async function BoqLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('boq')
  return children
}
