'use server'

import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types/billing'
import { getPermissionsForRole, normalizeRolePermissions, type PermissionModule } from '@/lib/permissions'

export async function getCurrentViewerRole(): Promise<UserRole | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: roleFromRpc } = await supabase.rpc('_billing_current_role')
  const role = roleFromRpc
  if (role === 'admin' || role === 'pm' || role === 'foreman') return role
  return 'foreman'
}

export async function getCurrentViewerPermissions(): Promise<Record<PermissionModule, boolean> | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const [{ data: roleFromRpc }, { data: settings }] = await Promise.all([
    supabase.rpc('_billing_current_role'),
    supabase.from('organization_settings').select('role_permissions').limit(1).maybeSingle(),
  ])

  const role: UserRole = roleFromRpc === 'admin' || roleFromRpc === 'pm' || roleFromRpc === 'foreman'
    ? roleFromRpc
    : 'foreman'

  return getPermissionsForRole(role, normalizeRolePermissions(settings?.role_permissions))
}
