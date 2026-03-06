'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getCurrentUserAndRole(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, role: 'foreman' as const }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  const role = profile?.role === 'admin' || profile?.role === 'pm' || profile?.role === 'foreman'
    ? profile.role
    : 'foreman'
  return { user, role }
}

async function ensureCurrentUserProfile(supabase: any) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (existing?.id) return

  await supabase
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

/**
 * Updates organization settings, including handling a logo upload.
 */
export async function updateOrganizationSettings(formData: FormData) {
  const supabase = await createClient()
  
  const settingsData = {
    company_name: formData.get('company_name') as string,
    address: formData.get('address') as string,
    tax_id: formData.get('tax_id') as string,
    phone: formData.get('phone') as string,
    default_vat: parseFloat(formData.get('default_vat') as string),
    default_wht: parseFloat(formData.get('default_wht') as string),
    default_retention: parseFloat(formData.get('default_retention') as string),
    updated_at: new Date().toISOString(),
  };

  const logoFile = formData.get('logo_url') as File | null;
  
  // Handle file upload
  if (logoFile && logoFile.size > 0) {
    const filePath = `public/logo-${new Date().getTime()}.${logoFile.name.split('.').pop()}`
    const { error: uploadError } = await supabase.storage
      .from('assets') // Assumes a bucket named 'assets'
      .upload(filePath, logoFile);

    if (uploadError) {
      throw new Error(`Logo upload failed: ${uploadError.message}`);
    }

    // Get public URL and add to settings data
    const { data: urlData } = supabase.storage.from('assets').getPublicUrl(filePath);
    (settingsData as any).logo_url = urlData.publicUrl;
  }

  // Upsert the data into the single settings row (id=1)
  const { error: upsertError } = await supabase
    .from('organization_settings')
    .update(settingsData)
    .eq('id', 1);

  if (upsertError) {
    console.error('Error updating settings:', upsertError)
    throw new Error(upsertError.message)
  }

  revalidatePath('/dashboard/settings')
  return { success: true }
}

/**
 * Retrieves all users and their associated roles from the 'profiles' table.
 */
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
      return me ? [me] : []
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
        return me ? [me] : []
    }
    return data;
}


/**
 * Updates the role for a specific user.
 */
export async function updateUserRole(userId: string, newRole: 'admin' | 'pm' | 'foreman') {
  const supabase = await createClient()
  const { role } = await getCurrentUserAndRole(supabase)
  if (role !== 'admin') throw new Error('Only admin can update user roles')
  
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
