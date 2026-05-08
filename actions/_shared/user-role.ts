import { createClient } from '@/lib/supabase/server'
import type { BillingUserSummary, UserRole } from '@/lib/types/billing'

type RpcRoleClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error?: { message: string } | null }>
}

export async function getCurrentUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
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
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const role = await getCurrentUserRole(supabase, user.id)
  if (!allowed.includes(role)) throw new Error(message)
  return { userId: user.id, role }
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

export async function getCurrentUserProfile(supabase: unknown, userId: string): Promise<BillingUserSummary | null> {
  const client = supabase as RoleQueryClient
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', userId)
    .single()

  if (error) return null
  return data
}
