import { requireModuleAccess } from '@/lib/auth/route-access'

export default async function CostControlLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Server-side gate: users without the `cost_control` permission are
  // redirected before any BOQ/cost data is fetched or rendered.
  await requireModuleAccess('cost_control')
  return <>{children}</>
}
