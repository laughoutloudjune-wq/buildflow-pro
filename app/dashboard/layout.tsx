import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'

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

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const role = profile?.role === 'admin' || profile?.role === 'pm' || profile?.role === 'foreman'
    ? profile.role
    : 'foreman'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <Sidebar userRole={role} />
      <div className="relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden ml-64">
        <Header userEmail={user.email} />
        <main className="w-full grow p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
