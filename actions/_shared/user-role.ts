import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getDashboardSession, type SessionUser } from '@/lib/auth/route-access'
import type { BillingUserSummary, UserRole } from '@/lib/types/billing'

/**
 * Identity for the current request, taken from the memoized dashboard
 * session. That session verifies the JWT locally via `auth.getClaims()`, so
 * this is free after the first call in a request - it used to be an
 * `auth.getUser()` network round trip per call site, and several actions
 * call it back-to-back with a role and profile lookup.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const { user } = await getDashboardSession()
  return user
}

/**
 * Enforce that a server action is called by an authenticated user whose role is
 * in `allowed`. Throws on failure so the action short-circuits. Returns the
 * user + role when it succeeds so callers can reuse them.
 */
export async function requireAuthRole(
  allowed: UserRole[],
  message = 'You do not have permission to perform this action'
): Promise<{ userId: string; role: UserRole }> {
  const { user, role } = await getDashboardSession()
  if (!user) throw new Error('Not authenticated')

  if (!allowed.includes(role)) throw new Error(message)
  return { userId: user.id, role }
}

type RpcRoleClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error?: { message: string } | null }>
}

type RoleQueryClient = {
  from: (table: string) => {
    select: (query: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data: { role?: string | null } | null }>
        single: () => PromiseLike<{ data: BillingUserSummary | null; error: { message: string } | null }>
      }
    }
  }
}

function normalizeUserRole(value: unknown): UserRole {
  return value === 'admin' || value === 'pm' || value === 'foreman' ? value : 'foreman'
}

export async function getCurrentUserRole(supabase: unknown, userId: string): Promise<UserRole> {
  // The dashboard session already resolved the caller's role for this request
  // and memoized it; reuse that instead of spending another round trip. Only
  // a lookup for somebody *other* than the caller falls through to a query.
  const session = await getDashboardSession()
  if (session.user?.id === userId) return session.role

  // Prefer the security-definer RPC helper so role reads still work even if
  // `profiles` has RLS enabled in the target environment.
  const rpcClient = supabase as RpcRoleClient
  try {
    const { data, error } = await rpcClient.rpc('_billing_current_role')
    if (!error) return normalizeUserRole(data)
  } catch {
    // fall back to direct table read below
  }

  const client = supabase as RoleQueryClient
  const { data } = await client.from('profiles').select('role').eq('id', userId).maybeSingle()
  return normalizeUserRole(data?.role)
}

export function requireRole(allowed: UserRole[], role: UserRole, message: string) {
  if (!allowed.includes(role)) throw new Error(message)
}

/** Memoized per request and keyed only on `userId` - the Supabase client is
 * recreated per call site, so keying on it would defeat `cache()`. */
const loadUserProfile = cache(async (userId: string): Promise<BillingUserSummary | null> => {
  const supabase = (await createClient()) as unknown as RoleQueryClient
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', userId)
    .single()

  if (error) return null
  return data
})

export async function getCurrentUserProfile(_supabase: unknown, userId: string): Promise<BillingUserSummary | null> {
  // The session already selected the caller's profile row in the same round
  // trip that resolved their role, so the common case costs nothing here.
  const session = await getDashboardSession()
  if (session.user?.id === userId && session.profile) {
    return session.profile as BillingUserSummary
  }
  return loadUserProfile(userId)
}
