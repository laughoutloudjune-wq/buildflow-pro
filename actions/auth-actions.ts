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

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  const role = profile?.role
  if (role === 'admin' || role === 'pm' || role === 'foreman') return role
  return 'foreman'
}

export async function getCurrentViewerPermissions(): Promise<Record<PermissionModule, boolean> | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const [{ data: profile }, { data: settings }] = await Promise.all([
    supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    supabase.from('organization_settings').select('role_permissions').limit(1).maybeSingle(),
  ])

  const role: UserRole =
    profile?.role === 'admin' || profile?.role === 'pm' || profile?.role === 'foreman'
      ? profile.role
      : 'foreman'

  return getPermissionsForRole(role, normalizeRolePermissions(settings?.role_permissions))
}
