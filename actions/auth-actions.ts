'use server'

import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types/billing'

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
