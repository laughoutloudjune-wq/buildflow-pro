'use server'

import { createClient } from '@/lib/supabase/server'
import { toUserRole, type UserRole } from '@/lib/types/billing'
import { getPermissionsForRole, normalizeRolePermissions, type PermissionModule } from '@/lib/permissions'

export async function getCurrentViewerRole(): Promise<UserRole | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: roleFromRpc } = await supabase.rpc('_billing_current_role')
  return toUserRole(roleFromRpc)
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

  const role: UserRole = toUserRole(roleFromRpc)

  return getPermissionsForRole(role, normalizeRolePermissions(settings?.role_permissions))
}
