'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { DEFAULT_ROLE_PERMISSIONS, normalizeRolePermissions, type RolePermissions } from '@/lib/permissions'
import { requireAuthRole } from '@/actions/_shared/user-role'
import { toUserRole, type UserRole } from '@/lib/types/billing'
import { createAdminClient } from '@/lib/supabase/admin'

type SettingsQueryClient = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string; email?: string | null; user_metadata?: { full_name?: string | null } } | null } }>
  }
  from: (table: string) => {
    select: (query: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data: { id?: string; role?: string | null; role_permissions?: unknown } | null }>
      }
      limit: (value: number) => {
        single: () => PromiseLike<{ data: Record<string, unknown> | null; error: { code?: string; message: string } | null }>
        maybeSingle: () => PromiseLike<{ data: { role_permissions?: unknown } | null; error: { code?: string; message: string } | null }>
      }
      order?: (column: string, options?: { ascending?: boolean }) => unknown
    }
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: number) => PromiseLike<{ error: { message: string } | null }>
    }
    upsert: (rows: Record<string, unknown>[], options?: { onConflict?: string }) => PromiseLike<{ error: { message: string } | null }>
  }
  storage: {
    from: (bucket: string) => {
      upload: (path: string, file: File) => Promise<{ error: { message: string } | null }>
      getPublicUrl: (path: string) => { data: { publicUrl: string } }
    }
  }
}

async function getCurrentUserAndRole(supabase: unknown) {
  const client = supabase as SettingsQueryClient
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { user: null, role: 'foreman' as const }
  const { data: profile } = await client
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  return { user, role: toUserRole(profile?.role) }
}

async function ensureCurrentUserProfile(supabase: unknown) {
  const client = supabase as SettingsQueryClient
  const { data: { user } } = await client.auth.getUser()
  if (!user) return

  const { data: existing } = await client
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (existing?.id) return

  await client
    .from('profiles')
    .upsert([{
      id: user.id,
      email: user.email || '',
      full_name: (user.user_metadata?.full_name || user.email || 'User') as string,
      role: 'foreman',
    }], { onConflict: 'id' })
}

/**
 * Retrieves the organization settings.
 * Assumes there is only ever one row in the table.
 */
export async function getOrganizationSettings() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('organization_settings')
    .select('*')
    .limit(1)
    .single()

  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
    console.error('Error fetching organization settings:', error)
    throw new Error(error.message)
  }

  return data
}

export async function getRolePermissions(): Promise<RolePermissions> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('organization_settings')
    .select('role_permissions')
    .limit(1)
    .maybeSingle()

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching role permissions:', error)
    return DEFAULT_ROLE_PERMISSIONS
  }

  return normalizeRolePermissions(data?.role_permissions)
}

/**
 * Updates the identity fields that print on the Billing PDF - company name,
 * tax ID, and the fallback approving signature used on a PO when the
 * issuing company hasn't uploaded one of its own (see companies.signature_url
 * in actions/procurement/vendors.ts). phone/address/logo_url used to live
 * here too, but nothing in the app ever rendered them - they were fields you
 * could fill in and save with no visible effect, so they were removed rather
 * than kept as a silent no-op.
 */
export async function updateBillingInfo(formData: FormData) {
  await requireAuthRole(['admin'])
  const supabase = await createClient()

  const settingsData = {
    company_name: formData.get('company_name') as string,
    tax_id: formData.get('tax_id') as string,
    updated_at: new Date().toISOString(),
    signature_url: undefined as string | undefined,
  }

  const signatureFile = formData.get('signature_url') as File | null;

  if (signatureFile && signatureFile.size > 0) {
    const filePath = `public/signature-${new Date().getTime()}.${signatureFile.name.split('.').pop()}`
    const { error: uploadError } = await supabase.storage
      .from('assets')
      .upload(filePath, signatureFile);

    if (uploadError) {
      throw new Error(`Signature upload failed: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage.from('assets').getPublicUrl(filePath);
    settingsData.signature_url = urlData.publicUrl
  }

  const { error: upsertError } = await supabase
    .from('organization_settings')
    .update(settingsData)
    .eq('id', 1);

  if (upsertError) {
    console.error('Error updating billing info:', upsertError)
    throw new Error(upsertError.message)
  }

  revalidatePath('/dashboard/settings/billing-info')
  revalidatePath('/dashboard/settings')
  return { success: true }
}

/**
 * Updates the default VAT/WHT/retention percentages pre-filled when
 * creating or reviewing a billing request (adjustable per-request afterward).
 */
export async function updateFinancialDefaults(formData: FormData) {
  await requireAuthRole(['admin'])
  const supabase = await createClient()

  const { error } = await supabase
    .from('organization_settings')
    .update({
      default_vat: parseFloat(formData.get('default_vat') as string) || 0,
      default_wht: parseFloat(formData.get('default_wht') as string) || 0,
      default_retention: parseFloat(formData.get('default_retention') as string) || 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);

  if (error) {
    console.error('Error updating financial defaults:', error)
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/settings/financial-defaults')
  revalidatePath('/dashboard/settings')
  return { success: true }
}

export async function updateRolePermissions(nextPermissions: RolePermissions) {
  const supabase = await createClient()
  const { role } = await getCurrentUserAndRole(supabase)
  if (role !== 'admin') throw new Error('Only admin can update permissions')

  const permissions = normalizeRolePermissions(nextPermissions)

  const { error } = await supabase
    .from('organization_settings')
    .upsert(
      [{
        id: 1,
        role_permissions: permissions,
        updated_at: new Date().toISOString(),
      }],
      { onConflict: 'id' }
    )

  if (error) {
    console.error('Error updating role permissions:', error)
    throw new Error(error.message)
  }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/settings')
  revalidatePath('/dashboard/settings/permissions')
  return { success: true }
}

/**
 * Retrieves all users and their associated roles from the 'profiles' table.
 */
/** Best-effort - banned_until lives on auth.users, not profiles, so this
 * needs the service-role client. If it fails for any reason, everyone just
 * shows as active rather than breaking the whole user list. */
async function getDisabledUserIds(): Promise<Set<string>> {
  try {
    const admin = createAdminClient()
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const now = Date.now()
    return new Set(
      (data?.users || [])
        .filter((u) => u.banned_until && new Date(u.banned_until).getTime() > now)
        .map((u) => u.id)
    )
  } catch {
    return new Set()
  }
}

export async function getUsers() {
    const supabase = await createClient()
    await ensureCurrentUserProfile(supabase)
    const { user, role } = await getCurrentUserAndRole(supabase)
    if (!user) return []

    // Non-admin can only see themselves.
    if (role !== 'admin') {
      const { data: me } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .eq('id', user.id)
        .maybeSingle()
      return me ? [{ ...me, disabled: false }] : []
    }

    const { data, error } = await supabase
        .from('profiles')
        .select(`
            id,
            full_name,
            email,
            role
        `)
        .order('email', { ascending: true })

    if (error) {
        console.error('Error fetching users:', error);
        // Fallback to current user only.
        const { data: me } = await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .eq('id', user.id)
          .maybeSingle()
        return me ? [{ ...me, disabled: false }] : []
    }

    const disabledIds = await getDisabledUserIds()
    return (data || []).map((u) => ({ ...u, disabled: disabledIds.has(u.id) }))
}


/**
 * Updates the role for a specific user.
 */
export async function updateUserRole(userId: string, newRole: UserRole) {
  const supabase = await createClient()
  const { user, role } = await getCurrentUserAndRole(supabase)
  if (role !== 'admin') throw new Error('Only admin can update user roles')

  // M-10: an admin who demotes themself (or the last other admin) leaves no
  // one who can fix it. Self-demotion is refused outright, even with other
  // admins around - it's always the wrong click to make on your own account.
  if (newRole !== 'admin') {
    const { data: target } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle()
    if (target?.role === 'admin') {
      if (user?.id === userId) {
        throw new Error('ไม่สามารถเปลี่ยนบทบาทของตัวเองออกจาก Admin ได้ ให้ผู้ดูแลระบบคนอื่นเปลี่ยนแทน')
      }
      const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
      if ((count || 0) <= 1) {
        throw new Error('ต้องมีผู้ดูแลระบบ (Admin) อย่างน้อย 1 คนเสมอ')
      }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId)

  if (error) {
    console.error('Error updating user role:', error)
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/settings')
  return { success: true }
}

/**
 * Bans/unbans a user in Supabase Auth (M-10) - a departed foreman keeps a
 * working login otherwise, and with the open-rules cleanup in Phase 1/6 that
 * means real data access. ban_duration '876000h' (~100 years) is Supabase's
 * own convention for "indefinite"; 'none' clears it.
 */
export async function setUserDisabled(userId: string, disabled: boolean) {
  const supabase = await createClient()
  const { user, role } = await getCurrentUserAndRole(supabase)
  if (role !== 'admin') throw new Error('เฉพาะ Admin เท่านั้นที่สามารถปิด/เปิดการใช้งานผู้ใช้ได้')

  if (disabled) {
    if (user?.id === userId) {
      throw new Error('ไม่สามารถปิดการใช้งานบัญชีตัวเองได้')
    }
    const { data: target } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle()
    if (target?.role === 'admin') {
      const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
      if ((count || 0) <= 1) {
        throw new Error('ต้องมีผู้ดูแลระบบ (Admin) อย่างน้อย 1 คนเสมอ')
      }
    }
  }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: disabled ? '876000h' : 'none' })
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/settings')
  return { success: true }
}

/**
 * Updates a user's display name. Signup defaults full_name to the account's
 * email when none is provided (see handle_auth_user_created), which is how
 * "ผู้จัดทำ" on a PO printout ends up showing an email address instead of a
 * name - this is how that gets fixed. Admin can rename anyone; everyone else
 * can only rename themselves.
 */
export async function updateUserFullName(userId: string, fullName: string) {
  const supabase = await createClient()
  const { user, role } = await getCurrentUserAndRole(supabase)
  if (!user) throw new Error('Not authenticated')
  if (role !== 'admin' && userId !== user.id) throw new Error('You can only change your own name')

  const trimmed = fullName.trim()
  if (!trimmed) throw new Error('กรุณาใส่ชื่อ')

  const { error } = await supabase
    .from('profiles')
    .update({ full_name: trimmed })
    .eq('id', userId)

  if (error) {
    console.error('Error updating user full name:', error)
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/settings')
  return { success: true }
}
