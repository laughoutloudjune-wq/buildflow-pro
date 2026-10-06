'use server'

import { revalidatePath } from 'next/cache'
import { requireAuthRole } from '@/actions/_shared/user-role'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/lib/types/billing'

const DEFAULT_SITE_URL = 'https://buildflow-pro-eight.vercel.app'

const INVITABLE_ROLES: UserRole[] = ['admin', 'pm', 'foreman', 'accountant', 'sales', 'sales_exec']

/**
 * Generates an invite link without sending an email, so it can be pasted
 * into Line/WhatsApp/etc instead - a workaround for Supabase's default
 * email sender being rate-limited. Links directly to /auth/confirm (a
 * token_hash query param, not GoTrue's hosted /verify redirect), so this
 * also sidesteps the Site URL/redirect fragment issues that route depends
 * on. Falls back to a recovery link when the email is already registered,
 * since a second invite for an existing user always fails.
 *
 * The invite creates the auth user immediately (and the profiles trigger
 * gives it the default 'foreman' role), so the chosen role is written right
 * after. That write goes through the admin's own session, not the service
 * role: the profiles role-change guard checks _billing_current_role(), which
 * only resolves to 'admin' for a real admin session. An existing account's
 * role is left alone - its link is just a password reset, and a role change
 * for it belongs in the users table where the last-admin checks live.
 */
export async function generateInviteLink(
  email: string,
  role: UserRole
): Promise<{ link: string; userId: string | null; existingUser: boolean; roleApplied: boolean }> {
  await requireAuthRole(['admin'], 'เฉพาะ Admin เท่านั้นที่สร้างลิงก์เชิญได้')

  const trimmed = email.trim()
  if (!trimmed) throw new Error('กรุณาใส่อีเมล')
  if (!INVITABLE_ROLES.includes(role)) throw new Error('บทบาทไม่ถูกต้อง')

  const admin = createAdminClient()
  const siteUrl = process.env.SITE_URL || DEFAULT_SITE_URL

  let existingUser = false
  let { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email: trimmed })

  if (error && error.message.toLowerCase().includes('already')) {
    existingUser = true
    ;({ data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: trimmed }))
  }

  if (error) throw new Error(error.message)
  if (!data?.properties) throw new Error('Supabase did not return a link')

  let roleApplied = false
  if (!existingUser && data.user?.id) {
    const supabase = await createClient()
    const { error: roleError } = await supabase.from('profiles').update({ role }).eq('id', data.user.id)
    roleApplied = !roleError
    if (roleApplied) revalidatePath('/dashboard/settings')
  }

  const { hashed_token, verification_type } = data.properties
  return {
    link: `${siteUrl}/auth/confirm?token_hash=${hashed_token}&type=${verification_type}&next=/set-password`,
    userId: data.user?.id ?? null,
    existingUser,
    roleApplied,
  }
}
