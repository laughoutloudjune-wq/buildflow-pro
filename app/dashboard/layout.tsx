import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardShell, { SIDEBAR_COLLAPSED_COOKIE } from '@/components/layout/DashboardShell'
import { getDashboardSession, permissionsForRole } from '@/lib/auth/route-access'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [{ user, role, permissions: rolePermissions }, cookieStore] = await Promise.all([
    getDashboardSession(),
    cookies(),
  ])

  if (!user) {
    redirect('/')
  }

  const permissions = permissionsForRole(role, rolePermissions)

  // Read on the server so the sidebar renders at its final width in the very
  // first HTML. This used to live in localStorage and be applied in an effect
  // after hydration, which shifted the entire page 176px sideways on every
  // load for anyone with a collapsed sidebar - the main source of the app's
  // Cumulative Layout Shift, and one that hit every dashboard route equally.
  const initialCollapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === '1'

  return (
    <DashboardShell
      permissions={permissions}
      userEmail={user.email}
      role={role}
      initialCollapsed={initialCollapsed}
    >
      {children}
    </DashboardShell>
  )
}
