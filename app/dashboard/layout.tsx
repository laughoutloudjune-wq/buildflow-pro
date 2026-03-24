import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import { getPermissionsForRole, normalizeRolePermissions } from '@/lib/permissions'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // สำคัญ: ต้องใส่ await ตรงนี้ด้วย เพราะ createClient เป็น async แล้ว
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/')
  }

  const [{ data: profile }, { data: settings }] = await Promise.all([
    supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('organization_settings')
      .select('role_permissions')
      .limit(1)
      .maybeSingle(),
  ])

  const role = profile?.role === 'admin' || profile?.role === 'pm' || profile?.role === 'foreman'
    ? profile.role
    : 'foreman'
  const permissions = getPermissionsForRole(role, normalizeRolePermissions(settings?.role_permissions))

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
