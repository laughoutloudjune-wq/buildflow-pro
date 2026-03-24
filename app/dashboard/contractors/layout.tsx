import { requireModuleAccess } from '@/lib/auth/route-access'

export default async function ContractorsLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('contractors')
  return children
}
