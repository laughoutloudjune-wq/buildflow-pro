import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types/billing'
import {
  canRoleAccessModule,
  getPermissionsForRole,
  normalizeRolePermissions,
  type PermissionModule,
  type RolePermissions,
} from '@/lib/permissions'

/**
 * Fetches {user, role, permissions} once per request and memoizes it via
 * React's `cache()`. The root dashboard layout, every section layout's
 * `requireModuleAccess` call, and the page component underneath it all used
 * to independently re-run `auth.getUser()` plus a role/permissions lookup -
 * up to 3-4 duplicate Supabase round trips stacked before a single page
 * could render. `cache()` dedupes those into one call per navigation.
 */
export const getDashboardSession = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, role: 'foreman' as UserRole, permissions: normalizeRolePermissions(null) }
  }

  const [{ data: roleFromRpc }, { data: settings }] = await Promise.all([
    supabase.rpc('_billing_current_role'),
    supabase.from('organization_settings').select('role_permissions').limit(1).maybeSingle(),
  ])

  const role: UserRole =
    roleFromRpc === 'admin' || roleFromRpc === 'pm' || roleFromRpc === 'foreman' ? roleFromRpc : 'foreman'
  const permissions = normalizeRolePermissions(settings?.role_permissions)

  return { user, role, permissions }
})

export async function requireDashboardRole(allowedRoles: UserRole[]) {
  const { user, role } = await getDashboardSession()

  if (!user) {
    redirect('/login')
  }

  if (!allowedRoles.includes(role)) {
    redirect('/dashboard')
  }

  return { user, role }
}

export async function requireModuleAccess(moduleKey: PermissionModule) {
  const { user, role, permissions } = await getDashboardSession()

  if (!user) {
    redirect('/login')
  }

  if (!canRoleAccessModule(role, moduleKey, permissions)) {
    redirect('/dashboard')
  }

  return { user, role, permissions }
}

/** Permissions for the current role, for callers that already gated access
 * via `requireModuleAccess`/`requireDashboardRole` and just need the matrix
 * (e.g. the root layout, to decide what to show in the sidebar). */
export function permissionsForRole(role: UserRole, permissions: RolePermissions) {
  return getPermissionsForRole(role, permissions)
}
