import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  canRoleAccessModule,
  normalizeRolePermissions,
  type PermissionModule,
} from '@/lib/permissions'
import type { UserRole } from '@/lib/types/billing'

export type AccessContext = {
  userId: string
  role: UserRole
}

/**
 * Server-side gate for a dashboard module. Redirects back to /dashboard if the
 * user is not allowed to access `moduleKey`, so no module data is ever rendered
 * to, or fetched on behalf of, a user who shouldn't see it.
 *
 * Returns the caller's id + normalized role on success so pages/layouts can
 * reuse them without a second round-trip.
 */
export async function requireModuleAccess(
  moduleKey: PermissionModule,
  fallbackHref = '/dashboard'
): Promise<AccessContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: roleFromRpc }, { data: settings }] = await Promise.all([
    supabase.rpc('_billing_current_role'),
    supabase.from('organization_settings').select('role_permissions').limit(1).maybeSingle(),
  ])

  const role: UserRole =
    roleFromRpc === 'admin' || roleFromRpc === 'pm' || roleFromRpc === 'foreman' ? roleFromRpc : 'foreman'

  const permissions = normalizeRolePermissions(settings?.role_permissions)
  if (!canRoleAccessModule(role, moduleKey, permissions)) {
    redirect(fallbackHref)
  }

  return { userId: user.id, role }
}
