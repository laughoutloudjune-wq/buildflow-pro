import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
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
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar permissions={permissions} />
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden ml-64">
        <Header userEmail={user.email} />
        <main className="w-full grow p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
