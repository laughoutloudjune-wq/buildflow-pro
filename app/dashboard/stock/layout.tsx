import { requireModuleAccess } from '@/lib/auth/route-access'

export default async function StockLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('materials')
  return children
}
