'use server'

import { requireAuthRole } from '@/actions/_shared/user-role'
import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_SITE_URL = 'https://buildflow-pro-eight.vercel.app'

/**
 * Generates an invite link without sending an email, so it can be pasted
 * into Line/WhatsApp/etc instead - a workaround for Supabase's default
 * email sender being rate-limited. Links directly to /auth/confirm (a
 * token_hash query param, not GoTrue's hosted /verify redirect), so this
 * also sidesteps the Site URL/redirect fragment issues that route depends
 * on. Falls back to a recovery link when the email is already registered,
 * since a second invite for an existing user always fails.
 */
export async function generateInviteLink(email: string) {
  await requireAuthRole(['admin'], 'เฉพาะ Admin เท่านั้นที่สร้างลิงก์เชิญได้')

  const trimmed = email.trim()
  if (!trimmed) throw new Error('กรุณาใส่อีเมล')

  const admin = createAdminClient()
  const siteUrl = process.env.SITE_URL || DEFAULT_SITE_URL

  let { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email: trimmed })

  if (error && error.message.toLowerCase().includes('already')) {
    ;({ data, error } = await admin.auth.admin.generateLink({ type: 'recovery', email: trimmed }))
  }

  if (error) throw new Error(error.message)
  if (!data?.properties) throw new Error('Supabase did not return a link')

  const { hashed_token, verification_type } = data.properties
  return `${siteUrl}/auth/confirm?token_hash=${hashed_token}&type=${verification_type}&next=/set-password`
}
