import { redirect } from 'next/navigation'
import DashboardShell from '@/components/layout/DashboardShell'
import { getDashboardSession, permissionsForRole } from '@/lib/auth/route-access'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, role, permissions: rolePermissions } = await getDashboardSession()

  if (!user) {
    redirect('/')
  }

  const permissions = permissionsForRole(role, rolePermissions)

  return (
    <DashboardShell permissions={permissions} userEmail={user.email}>
      {children}
    </DashboardShell>
  )
}
