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

/** The subset of the auth user this app actually reads, sourced from the
 * verified JWT claims rather than a round trip to the Auth server. */
export type SessionUser = { id: string; email?: string }

/**
 * Fetches {user, role, permissions} once per request and memoizes it via
 * React's `cache()`. The root dashboard layout, every section layout's
 * `requireModuleAccess` call, and the page component underneath it all used
 * to independently re-run `auth.getUser()` plus a role/permissions lookup -
 * up to 3-4 duplicate Supabase round trips stacked before a single page
 * could render. `cache()` dedupes those into one call per navigation.
 *
 * Identity comes from `auth.getClaims()`, not `auth.getUser()`. This project
 * signs JWTs with an asymmetric key (ES256), so `getClaims()` verifies the
 * token's signature locally against the cached JWKS instead of asking the
 * Auth server to do it - `getUser()` is an unconditional network call on
 * every render, measured at 145-306ms against this project's region, versus
 * ~0.07ms for a local ECDSA verify.
 * The trade-off is that a session stays valid until its access token expires
 * even if the user is deleted or banned server-side mid-token; every action
 * still re-reads the role from the database, and RLS remains the real
 * authority on what the token can touch.
 */
export const getDashboardSession = cache(async () => {
  const supabase = await createClient()

  // getClaims() also refreshes an expired session (it reads through
  // getSession()), so cookie rotation still happens exactly as before.
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims

  if (!claims?.sub) {
    return {
      user: null,
      role: 'foreman' as UserRole,
      permissions: normalizeRolePermissions(null),
      profile: null,
    }
  }

  const user: SessionUser = { id: claims.sub, email: claims.email }

  // One round trip for the caller's profile row and the permission matrix.
  // Selecting `full_name` alongside `role` here means actions that need the
  // profile (billing submit/review) no longer pay a second lookup for it.
  const [{ data: profile, error: profileError }, { data: settings }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, role').eq('id', user.id).maybeSingle(),
    supabase.from('organization_settings').select('role_permissions').limit(1).maybeSingle(),
  ])

  // `profiles` is readable by the owner here, but fall back to the
  // security-definer RPC so a stricter RLS setup still resolves a role.
  let rawRole: unknown = profile?.role
  if (profileError || rawRole == null) {
    const { data: roleFromRpc } = await supabase.rpc('_billing_current_role')
    rawRole = roleFromRpc
  }

  const role: UserRole =
    rawRole === 'admin' || rawRole === 'pm' || rawRole === 'foreman' ? rawRole : 'foreman'
  const permissions = normalizeRolePermissions(settings?.role_permissions)

  return { user, role, permissions, profile: profile ?? null }
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
