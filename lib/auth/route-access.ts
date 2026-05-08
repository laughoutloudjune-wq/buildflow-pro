import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types/billing'
import { canRoleAccessModule, normalizeRolePermissions, type PermissionModule } from '@/lib/permissions'

export async function requireDashboardRole(allowedRoles: UserRole[]) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: roleFromRpc } = await supabase.rpc('_billing_current_role')
  const role: UserRole =
    roleFromRpc === 'admin' || roleFromRpc === 'pm' || roleFromRpc === 'foreman' ? roleFromRpc : 'foreman'

  if (!allowedRoles.includes(role)) {
    redirect('/dashboard')
  }

  return { user, role }
}

export async function requireModuleAccess(moduleKey: PermissionModule) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [{ data: roleFromRpc }, { data: settings }] = await Promise.all([
    supabase.rpc('_billing_current_role'),
    supabase.from('organization_settings').select('role_permissions').limit(1).maybeSingle(),
  ])

  const role: UserRole =
    roleFromRpc === 'admin' || roleFromRpc === 'pm' || roleFromRpc === 'foreman' ? roleFromRpc : 'foreman'

  const permissions = normalizeRolePermissions(settings?.role_permissions)
  if (!canRoleAccessModule(role, moduleKey, permissions)) {
    redirect('/dashboard')
  }

  return { user, role, permissions }
}
