import { createClient } from '@supabase/supabase-js'

// Service-role client for admin-only operations (e.g. generating invite
// links without sending an email). Never import this from client code -
// SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix so Next.js won't
// inline it into the browser bundle, but the import itself should still
// only ever happen inside 'use server' files.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set - add it in .env.local and in Vercel project settings')
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
