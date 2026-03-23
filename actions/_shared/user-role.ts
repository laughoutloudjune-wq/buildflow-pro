import { createClient } from '@/lib/supabase/server'
import type { BillingUserSummary, UserRole } from '@/lib/types/billing'

export async function getCurrentUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
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

export async function getCurrentUserRole(supabase: unknown, userId: string): Promise<UserRole> {
  const client = supabase as RoleQueryClient
  const { data } = await client.from('profiles').select('role').eq('id', userId).maybeSingle()
  const role = data?.role
  if (role === 'admin' || role === 'pm' || role === 'foreman') return role
  return 'foreman'
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
