import { requireModuleAccess } from '@/lib/auth/require-access'

export default async function BillingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Server-side gate: users without the `billing` permission are redirected
  // before any billing data is fetched or rendered. This replaces the old
  // client-side <ClientRoleGate /> which ran after the page had already
  // mounted and started fetching.
  await requireModuleAccess('billing')
  return <>{children}</>
}
