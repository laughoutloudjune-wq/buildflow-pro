import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types/billing'

export async function requireDashboardRole(allowedRoles: UserRole[]) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const role: UserRole =
    profile?.role === 'admin' || profile?.role === 'pm' || profile?.role === 'foreman'
      ? profile.role
      : 'foreman'

  if (!allowedRoles.includes(role)) {
    redirect('/dashboard')
  }

  return { user, role }
}
